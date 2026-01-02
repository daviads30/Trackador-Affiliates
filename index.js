/**
 * Telegram Bot - Superbet Tracking Link Builder
 *
 * Fluxo:
 * 1) /start (ou /setlink) -> bot pede link de afiliado (wlsuperbet.../C.ashx?...).
 * 2) Bot extrai e salva: siteid, affid, adid, c (todos do link enviado).
 * 3) Bot pede o BILHETE:
 *    - aceita o link completo: https://superbet.bet.br/bilhete-compartilhado/891S-YJLHXM
 *    - OU aceita só o código: 891S-YJLHXM
 * 4) Bot responde com:
 *    https://wlsuperbet.adsrv.eacdn.com/C.ashx?btag=a_{siteid}b_{adid}c_&affid={affid}&siteid={siteid}&adid={adid}&c={c}&asclurl={bilhete}
 *
 * Armazenamento: arquivo db.json local (simples).
 */

import "dotenv/config";
import { Telegraf } from "telegraf";
import fs from "fs";

const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== CONFIG =====
const DB_FILE = "./db.json";
const BET_HOST = "superbet.bet.br";
const BET_PATH_PREFIX = "/bilhete-compartilhado/";

// ===== DB HELPERS =====
function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return { users: {} };
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { users: {} };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function getUser(db, userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      step: "idle", // idle | waiting_affiliate_link | waiting_bet
      affiliate: null, // { siteid, affid, adid, c }
    };
  }
  return db.users[userId];
}

// ===== PARSERS =====
function parseAffiliateLink(text) {
  let url;
  try {
    url = new URL(text.trim());
  } catch {
    throw new Error("Link inválido (não parece uma URL).");
  }

  const hostOk = url.hostname.includes("wlsuperbet.adsrv.eacdn.com");
  const pathOk = url.pathname.toLowerCase().endsWith("/c.ashx");
  if (!hostOk || !pathOk) {
    throw new Error(
      "Esse não parece ser o link de afiliado do tracking (wlsuperbet.../C.ashx)."
    );
  }

  const siteid = url.searchParams.get("siteid");
  const affid = url.searchParams.get("affid");
  const adid = url.searchParams.get("adid");
  const c = url.searchParams.get("c"); // vem do link

  if (!siteid || !affid || !adid || !c) {
    throw new Error("Link incompleto. Precisa conter: siteid, affid, adid e c.");
  }

  if (!/^\d+$/.test(siteid)) throw new Error("siteid inválido (deveria ser numérico).");
  if (!/^\d+$/.test(affid)) throw new Error("affid inválido (deveria ser numérico).");
  if (!/^\d+$/.test(adid)) throw new Error("adid inválido (deveria ser numérico).");

  return { siteid, affid, adid, c };
}

/**
 * Aceita:
 *  - LINK: https://superbet.bet.br/bilhete-compartilhado/891S-YJLHXM
 *  - CÓDIGO: 891S-YJLHXM
 */
function parseBetInput(input) {
  const raw = input.trim();

  // Caso 1: usuário mandou só o código (sem http)
  // Permite letras/números e hífen, com tamanho razoável
  const codeOnlyMatch = raw.match(/^[A-Za-z0-9-]{4,40}$/);
  if (codeOnlyMatch) {
    const code = raw;
    return {
      code,
      fullUrl: `https://${BET_HOST}${BET_PATH_PREFIX}${code}`,
    };
  }

  // Caso 2: usuário mandou URL completa
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "Bilhete inválido. Envie o link completo OU somente o código (ex: 891S-YJLHXM)."
    );
  }

  const hostOk = url.hostname.includes(BET_HOST);
  const pathMatch = url.pathname.match(/^\/bilhete-compartilhado\/([A-Za-z0-9-]+)$/);

  if (!hostOk || !pathMatch) {
    throw new Error(
      "Bilhete inválido. Envie o link completo (/bilhete-compartilhado/...) OU somente o código (ex: 891S-YJLHXM)."
    );
  }

  const code = pathMatch[1];
  return {
    code,
    fullUrl: `https://${BET_HOST}${BET_PATH_PREFIX}${code}`,
  };
}

// ===== BUILDER =====
function buildFinalTrackingLink(affiliate, betUrl) {
  const { siteid, affid, adid, c } = affiliate;

  // Exatamente no padrão pedido: a_{siteid}b_{adid}c_
  const btag = `a_${siteid}b_${adid}c_`;

  const url = new URL("https://wlsuperbet.adsrv.eacdn.com/C.ashx");
  url.searchParams.set("btag", btag);
  url.searchParams.set("affid", affid);
  url.searchParams.set("siteid", siteid);
  url.searchParams.set("adid", adid);
  url.searchParams.set("c", c); // c extraído do link
  url.searchParams.set("asclurl", betUrl); // destino final

  return url.toString();
}

// ===== COMMANDS =====
bot.start(async (ctx) => {
  const db = loadDB();
  const userId = String(ctx.from.id);
  const u = getUser(db, userId);

  u.step = "waiting_affiliate_link";
  saveDB(db);

  return ctx.reply(
    "✅ Vamos configurar seu link.\n\n" +
      "1) Me envie agora seu LINK DE AFILIADO (wlsuperbet.../C.ashx?...)\n" +
      "Exemplo:\n" +
      "https://wlsuperbet.adsrv.eacdn.com/C.ashx?btag=a_11566b_431c_&affid=662&siteid=11566&adid=431&c=Telegram"
  );
});

bot.command("setlink", async (ctx) => {
  const db = loadDB();
  const userId = String(ctx.from.id);
  const u = getUser(db, userId);

  u.step = "waiting_affiliate_link";
  saveDB(db);

  return ctx.reply("Beleza. Me envie seu LINK DE AFILIADO agora (wlsuperbet.../C.ashx?...).");
});

bot.command("bilhete", async (ctx) => {
  const db = loadDB();
  const userId = String(ctx.from.id);
  const u = getUser(db, userId);

  if (!u.affiliate) {
    u.step = "waiting_affiliate_link";
    saveDB(db);
    return ctx.reply("Antes preciso do seu link de afiliado. Me envie o link (wlsuperbet.../C.ashx?...).");
  }

  u.step = "waiting_bet";
  saveDB(db);

  return ctx.reply(
    "Agora me envie o BILHETE:\n" +
      "✅ Pode ser o link completo:\n" +
      "https://superbet.bet.br/bilhete-compartilhado/891S-YJLHXM\n\n" +
      "✅ Ou somente o código:\n" +
      "891S-YJLHXM"
  );
});

bot.command("me", async (ctx) => {
  const db = loadDB();
  const userId = String(ctx.from.id);
  const u = getUser(db, userId);

  if (!u.affiliate) return ctx.reply("Você ainda não configurou seu link. Use /start ou /setlink.");

  const a = u.affiliate;
  return ctx.reply(
    "✅ Seu cadastro atual:\n" +
      `siteid: ${a.siteid}\n` +
      `affid: ${a.affid}\n` +
      `adid: ${a.adid}\n` +
      `c: ${a.c}\n\n` +
      "Para trocar, use /setlink."
  );
});

bot.command("reset", async (ctx) => {
  const db = loadDB();
  const userId = String(ctx.from.id);
  db.users[userId] = { step: "idle", affiliate: null };
  saveDB(db);
  return ctx.reply("✅ Resetado. Use /start para configurar de novo.");
});

bot.command("help", async (ctx) => {
  return ctx.reply(
    "📌 Comandos:\n" +
      "/start - configurar link\n" +
      "/setlink - trocar link de afiliado\n" +
      "/bilhete - gerar link do bilhete\n" +
      "/me - ver cadastro\n" +
      "/reset - apagar cadastro\n\n" +
      "Você pode colar o link de afiliado ou mandar o código do bilhete direto (ex: 891S-YJLHXM)."
  );
});

// ===== TEXT HANDLER =====
bot.on("text", async (ctx) => {
  const db = loadDB();
  const userId = String(ctx.from.id);
  const u = getUser(db, userId);

  const text = ctx.message.text.trim();

  try {
    // 1) Esperando link afiliado
    if (u.step === "waiting_affiliate_link") {
      const affiliate = parseAffiliateLink(text);

      u.affiliate = affiliate;
      u.step = "waiting_bet";
      saveDB(db);

      return ctx.reply(
        "✅ Link de afiliado salvo!\n" +
          `siteid: ${affiliate.siteid}\n` +
          `affid: ${affiliate.affid}\n` +
          `adid: ${affiliate.adid}\n` +
          `c: ${affiliate.c}\n\n` +
          "Agora me envie o BILHETE (link ou código):\n" +
          "Ex: 891S-YJLHXM"
      );
    }

    // 2) Esperando bilhete (link OU código)
    if (u.step === "waiting_bet") {
      if (!u.affiliate) {
        u.step = "waiting_affiliate_link";
        saveDB(db);
        return ctx.reply("Me envie primeiro seu link de afiliado (wlsuperbet.../C.ashx?...).");
      }

      const bet = parseBetInput(text);
      const finalLink = buildFinalTrackingLink(u.affiliate, bet.fullUrl);

      u.step = "idle";
      saveDB(db);

      return ctx.reply("🎟️ Aqui está seu link rastreado:\n" + finalLink);
    }

    // ===== Fora do fluxo (auto-detect) =====

    // Se colar link de afiliado -> salva e pede bilhete
    if (text.includes("wlsuperbet.adsrv.eacdn.com/C.ashx")) {
      const affiliate = parseAffiliateLink(text);

      u.affiliate = affiliate;
      u.step = "waiting_bet";
      saveDB(db);

      return ctx.reply("✅ Link de afiliado salvo! Agora mande o BILHETE (link ou código).");
    }

    // Se mandou link completo do bilhete e já tem afiliado -> gera
    if (text.includes("superbet.bet.br/bilhete-compartilhado/")) {
      if (!u.affiliate) {
        u.step = "waiting_affiliate_link";
        saveDB(db);
        return ctx.reply("Antes configure seu link de afiliado com /start ou cole seu link (wlsuperbet.../C.ashx?...).");
      }

      const bet = parseBetInput(text);
      const finalLink = buildFinalTrackingLink(u.affiliate, bet.fullUrl);
      return ctx.reply("🎟️ Link rastreado:\n" + finalLink);
    }

    // Se mandou só o código (ex: 891S-YJLHXM) e já tem afiliado -> gera
    if (/^[A-Za-z0-9-]{4,40}$/.test(text)) {
      if (!u.affiliate) {
        u.step = "waiting_affiliate_link";
        saveDB(db);
        return ctx.reply("Antes configure seu link de afiliado com /start ou cole seu link (wlsuperbet.../C.ashx?...).");
      }

      const bet = parseBetInput(text);
      const finalLink = buildFinalTrackingLink(u.affiliate, bet.fullUrl);
      return ctx.reply("🎟️ Link rastreado:\n" + finalLink);
    }

    return ctx.reply("Não entendi. Use /help.");
  } catch (err) {
    return ctx.reply("❌ " + err.message + "\n\nUse /reset se quiser recomeçar.");
  }
});

// ===== START BOT =====
bot.launch();
console.log("Bot rodando...");

// Encerramento limpo
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
