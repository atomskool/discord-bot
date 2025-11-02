import express from "express";
import bodyParser from "body-parser";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { google } from "googleapis";
import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import schedule from "node-schedule";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================== 建立 Google 憑證檔案（Base64） =====================
const credentialsPath = path.join(__dirname, "credentials.json");

if (!fs.existsSync(credentialsPath)) {
  try {
    const decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS, "base64").toString("utf-8");
    fs.writeFileSync(credentialsPath, decoded);
    console.log("✅ 已建立 credentials.json 憑證檔案（Base64）");
  } catch (err) {
    console.error("❌ 建立 credentials.json 失敗：", err);
  }
}

// ===================== ✅ 新增 Express 伺服器 =====================
const app = express();
const PORT = process.env.PORT || 3000;

// 提供 Render 健康檢查使用
app.get("/", (req, res) => {
  res.send("✅ Discord Bot 正在運作中！");
});

app.listen(PORT, () => {
  console.log(`🚀 Express 伺服器已啟動，埠號：${PORT}`);
});

// ===================== Discord Bot 主程式 =====================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ===================== Google Sheets 驗證設定 =====================
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

// ===================== ✅ 新增：接收 GAS 課程推播 =====================
app.use(bodyParser.json());

// 📩 接收 GAS 傳送課程
app.post("/receive", async (req, res) => {
  try {
    const { rowIndex, course } = req.body;
    if (!rowIndex || !course) {
      return res.status(400).send("❌ 缺少 rowIndex 或 course");
    }

    console.log(`📦 收到課程資料（第 ${rowIndex} 列）`);

    // 取得使用者清單
    const userRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: "DC 使用者名單!A2:C",
    });
    const users = userRes.data.values || [];

    // 組課程訊息
    const message = `
📢 **新課程通知**

**學校：** ${course["學校"] || ""}
**日期：** ${course["日期"] || ""}
**時間：** ${course["開始時間"] || ""}～${course["結束時間"] || ""}
**年級：** ${course["年級"] || ""}
**主題：** ${course["主題"] || ""}
**人數：** ${course["人數"] || ""}
**備註：** ${course["備註"] || "（無）"}

請選擇您的意願👇`;

    // 按鈕排版
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`join_${rowIndex}_講師`)
        .setLabel("講師")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`join_${rowIndex}_引導師`)
        .setLabel("引導師")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`join_${rowIndex}_歐都給`)
        .setLabel("歐都給")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`join_${rowIndex}_都不行`)
        .setLabel("都不行")
        .setStyle(ButtonStyle.Danger)
    );

    // 發送通知給所有使用者
    for (const u of users) {
      const userId = u[0];
      try {
        const discordUser = await client.users.fetch(userId);
        await discordUser.send({ content: message, components: [row] });
        console.log(`✅ 已通知 ${u[1]} (${userId})`);
      } catch {
        console.warn(`⚠️ 無法發送給 ${u[1]} (${userId})`);
      }
    }

    res.status(200).send("✅ 已成功發送課程通知");
  } catch (err) {
    console.error("❌ 接收課程錯誤：", err);
    res.status(500).send("伺服器錯誤");
  }
});

// ===================== ✅ 新增：按鈕互動事件 =====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    const [_, rowIndex, choice] = interaction.customId.split("_");
    const userId = interaction.user.id;

    // 找使用者姓名
    const userRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: "DC 使用者名單!A2:C",
    });
    const users = userRes.data.values || [];
    const matched = users.find((r) => r[0] === userId);
    if (!matched) {
      await interaction.reply({
        content: "⚠️ 尚未註冊姓名，請先使用 `/註冊姓名`。",
        ephemeral: true,
      });
      return;
    }

    const userName = matched[1];

    // 找課程報名區欄位
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: "課程報名區!A1:Z1",
    });
    const headers = headerRes.data.values[0];
    const targetColIndex = headers.findIndex((h) => h === userName);

    if (targetColIndex === -1) {
      await interaction.reply({
        content: `⚠️ 找不到對應欄位「${userName}」，請聯絡管理員！`,
        ephemeral: true,
      });
      return;
    }

    const colLetter = String.fromCharCode(65 + targetColIndex);
    const range = `課程報名區!${colLetter}${rowIndex}`;

    // 寫入選擇結果
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[choice]] },
    });

    await interaction.reply({
      content: `✅ ${userName} 已選擇「${choice}」，已寫入報名表第 ${rowIndex} 列。`,
      ephemeral: true,
    });

    console.log(`📝 ${userName} 選擇「${choice}」→ 第 ${rowIndex} 列`);
  } catch (err) {
    console.error("❌ 按鈕錯誤：", err);
    await interaction.reply({
      content: "發生錯誤，請稍後再試。",
      ephemeral: true,
    });
  }
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
