import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName("註冊姓名")
    .setDescription("讓我記住你的姓名")
    .addStringOption(option =>
      option.setName("姓名").setDescription("請輸入你的姓名（兩到三個中文字）").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("查課程")
    .setDescription("查詢你之後的課程"),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log("📤 正在註冊指令...");
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log("✅ 指令註冊成功！");
} catch (error) {
  console.error(error);
}
