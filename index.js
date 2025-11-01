import { google } from "googleapis";
import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import schedule from "node-schedule";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ===================== Google Sheets 驗證設定（Render 版本） =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const credentialsPath = path.join(__dirname, "credentials.json");

// 🔒 如果 credentials.json 不存在，就從環境變數建立一份（Render 專用）
if (!fs.existsSync(credentialsPath)) {
  fs.writeFileSync(credentialsPath, process.env.GOOGLE_CREDENTIALS);
  console.log("✅ 已建立 credentials.json 憑證檔案");
}

const auth = new google.auth.GoogleAuth({
  keyFile: credentialsPath,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// ===================== 啟動機器人 =====================
client.once("ready", () => {
  console.log(`✅ 已登入：${client.user.tag}`);
});

// ===================== 指令監聽 =====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;

  // ✅ /註冊姓名
  if (interaction.commandName === "註冊姓名") {
    const inputName = interaction.options.getString("姓名").trim();
    const nameRegex = /^[\u4e00-\u9fa5]{2,3}$/;

    if (!nameRegex.test(inputName)) {
      await interaction.reply("⚠️ 姓名格式不正確，請輸入兩到三個中文字。");
      return;
    }

    const userSheet = "DC 使用者名單";
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${userSheet}!A2:C`,
    });

    const rows = res.data.values || [];
    const alreadyExists = rows.some((r) => r[0] === userId);

    if (alreadyExists) {
      await interaction.reply("你已經註冊過囉 ✅");
      return;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: userSheet,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[userId, inputName, interaction.user.username]] },
    });

    await interaction.reply(`感謝你，${inputName}！我已記住你囉 😄`);
  }

  // ✅ /查課程
  if (interaction.commandName === "查課程") {
    await interaction.deferReply();
    try {
      const userRes = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: "DC 使用者名單!A2:C",
      });
      const userList = userRes.data.values || [];
      const matched = userList.find((r) => r[0] === userId);

      if (!matched) {
        await interaction.editReply("⚠️ 請先使用 `/註冊姓名` 註冊你的名字！");
        return;
      }

      const userName = matched[1];
      const sheetData = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SHEET_ID,
        range: "Line 自動通知!A1:Z",
      });

      const rows = sheetData.data.values;
      const header = rows[0];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let results = [];

      for (let i = 1; i < rows.length; i++) {
        const row = Object.fromEntries(header.map((h, idx) => [h, rows[i][idx]]));
        const lecturer = row["講師"] || "";
        const facilitator = row["引導師"] || "";
        let rawDate;

        // ✅ 解析「11月21日 星期五」格式
        if (row["日期"]) {
          const text = row["日期"].toString().trim();
          if (text.includes("月") && text.includes("日")) {
            const match = text.match(/(\d{1,2})月(\d{1,2})日/);
            if (match) {
              const year = new Date().getFullYear();
              rawDate = new Date(year, parseInt(match[1]) - 1, parseInt(match[2]));
            }
          } else {
            rawDate = new Date(text.replace(/\//g, "-"));
          }
        }

        if (!rawDate || isNaN(rawDate)) continue;
        rawDate.setHours(0, 0, 0, 0);

        if ((lecturer.includes(userName) || facilitator.includes(userName)) && rawDate >= today) {
          const dateStr = `${rawDate.getMonth() + 1}月${rawDate.getDate()}日`;
          const start = row["開始時間"] || "";
          const end = row["結束時間"] || "";

          const msg =
`**學校：${row["學校"] || ""}**
**日期：${dateStr}**
**時間：${start}～${end}**
**人數：${row["人數"] || ""}**
**年級：${row["年級"] || ""}**
**主題：${row["主題"] || ""}**
**講師：${row["講師"] || ""}**
**引導師：${row["引導師"] || ""}**
**說明：${row["說明"] || "（無）"}**
**聯絡對象：${row["聯絡對象"] || ""}**
**聯絡電話：${row["聯絡電話"] || ""}**`;

          results.push(msg);
        }
      }

      if (results.length === 0) {
        await interaction.editReply(`目前沒有 ${userName} 的後續課程喔！`);
      } else {
        await interaction.editReply(`${userName} 之後的課程如下：\n\n${results.join("\n\n---\n\n")}`);
      }
    } catch (err) {
      console.error("查課程錯誤：", err);
      await interaction.editReply("查詢時發生錯誤，請稍後再試！");
    }
  }
});

// ===================== ⏰ 每日自動提醒（明天 + 一週後） =====================
schedule.scheduleJob("0 8 * * *", async () => {
  console.log("⏰ 開始每日提醒檢查...");
  try {
    const userRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: "DC 使用者名單!A2:C",
    });
    const userList = userRes.data.values || [];

    const courseRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: "Line 自動通知!A1:Z",
    });
    const rows = courseRes.data.values;
    const header = rows[0];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    for (let i = 1; i < rows.length; i++) {
      const row = Object.fromEntries(header.map((h, idx) => [h, rows[i][idx]]));
      const lecturer = row["講師"] || "";
      const facilitator = row["引導師"] || "";
      let rawDate;

      if (row["日期"]) {
        const text = row["日期"].toString().trim();
        if (text.includes("月") && text.includes("日")) {
          const match = text.match(/(\d{1,2})月(\d{1,2})日/);
          if (match) {
            const year = new Date().getFullYear();
            rawDate = new Date(year, parseInt(match[1]) - 1, parseInt(match[2]));
          }
        } else {
          rawDate = new Date(text.replace(/\//g, "-"));
        }
      }

      if (!rawDate || isNaN(rawDate)) continue;
      rawDate.setHours(0, 0, 0, 0);

      const matchedUsers = userList.filter(
        (u) => lecturer.includes(u[1]) || facilitator.includes(u[1])
      );

      // ✅ 明天提醒
      if (rawDate.getTime() === tomorrow.getTime()) {
        await sendReminder(matchedUsers, row, "明天");
      }

      // ✅ 一週後提醒
      if (rawDate.getTime() === nextWeek.getTime()) {
        await sendReminder(matchedUsers, row, "下週");
      }
    }

    console.log("✅ 每日提醒檢查完成。");
  } catch (err) {
    console.error("❌ 自動提醒錯誤：", err);
  }
});

// ===================== 通用提醒訊息函式 =====================
async function sendReminder(users, row, type) {
  for (const u of users) {
    const userId = u[0];
    try {
      const user = await client.users.fetch(userId);
      const message =
`**通知通知📢${type === "明天" ? "明天有課程呦～" : "下週有課程呦～"}**

**學校：${row["學校"] || ""}**
**日期：${row["日期"] || ""}**
**時間：${row["開始時間"] || ""}～${row["結束時間"] || ""}**
**人數：${row["人數"] || ""}**
**年級：${row["年級"] || ""}**
**主題：${row["主題"] || ""}**
**講師：${row["講師"] || ""}**
**引導師：${row["引導師"] || ""}**
**說明：${row["說明"] || "（無）"}**
**聯絡對象：${row["聯絡對象"] || ""}**
**聯絡電話：${row["聯絡電話"] || ""}**`;

      await user.send(message);
      console.log(`✅ 已通知 ${u[1]} (${type}課程提醒)`);
    } catch (err) {
      console.warn(`⚠️ 無法發送訊息給 ${u[1]} (${userId})`);
    }
  }
}

// ===================== 啟動登入 =====================
client.login(process.env.DISCORD_TOKEN);
