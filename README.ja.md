<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoGemClaw" width="400">
</p>

<p align="center">
  <strong>Gemini CLI</strong> で動作する個人用AIアシスタント。コンテナ内で安全に実行。軽量で理解しやすく、カスタマイズ可能。
</p>

<p align="center">
  <em><a href="https://github.com/gavrielc/nanoclaw">NanoClaw</a> からフォーク - Claude Agent SDK を Gemini CLI に、WhatsApp を Telegram に置き換え</em>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
  <strong>日本語</strong>
</p>

## なぜ NanoGemClaw？

**NanoGemClaw** は [NanoClaw](https://github.com/gavrielc/nanoclaw) のフォークで、Claude Agent SDK を **Gemini CLI** に、WhatsApp を **Telegram** に置き換えています：

| 機能 | NanoClaw | NanoGemClaw |
|------|----------|-------------|
| **エージェントランタイム** | Claude Agent SDK | Gemini CLI |
| **メッセージング** | WhatsApp (Baileys) | Telegram Bot API |
| **コスト** | Claude Max ($100/月) | 無料枠 (60リクエスト/分) |
| **メモリファイル** | CLAUDE.md | GEMINI.md |
| **モデル** | Claude 3.5 Sonnet | Gemini 2.5 Pro/Flash |
| **メディアサポート** | テキストのみ | 写真、音声、オーディオ、動画、ドキュメント |

同じコンテナ分離アーキテクチャ。異なるAIバックエンド。

---

## 🚀 クイックスタート

### 前提条件

| ツール | 用途 | インストール |
|--------|------|--------------|
| **Node.js 20+** | メインプロセスを実行 | [nodejs.org](https://nodejs.org) |
| **Gemini CLI** | AIエージェントコア | `npm install -g @google/gemini-cli` |
| **コンテナランタイム** | サンドボックス環境 | 以下を参照 |

**コンテナランタイムをインストール（どちらか選択）:**

```bash
# macOS - Apple Container（推奨）
brew install apple-container

# macOS/Linux - Docker
brew install --cask docker   # macOS
# または https://docker.com からダウンロード
```

---

### ステップ 1: リポジトリをクローン

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
npm install
```

---

### ステップ 2: Telegram Bot を作成

1. Telegram で **@BotFather** を検索
2. `/newbot` を送信
3. 指示に従ってBotに名前を付ける
4. BotFather が提供する **Token** をコピー

```bash
# Token を含む .env ファイルを作成
echo "TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz" > .env
```

---

### ステップ 3: Bot Token を検証

```bash
npm run setup:telegram
```

成功時の出力:

```
✓ Bot token is valid!
  Bot Username: @YourBotName
```

---

### ステップ 4: Gemini CLI にログイン (OAuth)

初回使用時は Google ログインが必要です：

```bash
gemini
```

ターミナルの指示に従って OAuth ログインを完了してください。認証済みの資格情報は自動的にコンテナと共有されます。

> 💡 **ヒント**: API Key を使用する場合は、`.env` ファイルに `GEMINI_API_KEY=your_key` を追加してください。

---

### ステップ 5: エージェントコンテナをビルド

```bash
cd container
./build.sh
cd ..
```

これにより、Gemini CLI と必要なツールを含む `nanogemclaw-agent:latest` イメージがビルドされます。

---

### ステップ 6: Telegram グループを設定

1. Bot を Telegram グループに追加
2. **Bot を管理者に昇格**（メッセージを読むために必要）
3. グループ ID をメモ（Bot にメッセージを送信後、ログで確認できます）

---

### ステップ 7: サービスを開始

```bash
npm run dev
```

成功時の出力:

```
✓ NanoGemClaw running (trigger: @Andy)
  Bot: @YourBotName
  Registered groups: 0
```

---

### ステップ 8: グループを登録

初回は、プライベートチャット（Bot との 1:1 会話）でこのコマンドを送信：

```
@Andy register this group as main
```

これにより、現在のチャットがフル管理者権限を持つ「メイングループ」として設定されます。

後で他のグループを追加するには、メイングループから送信：

```
@Andy join the "My Group Name" group
```

---

## ✅ 完了

これで、登録済みのグループで AI アシスタントとチャットできます：

```
@Andy こんにちは
@Andy 今日の天気を教えて
@Andy 毎朝9時に会議をリマインドして
```

---

## サポート機能

- **Telegram I/O** - スマートフォンから Gemini にメッセージ送信（写真、音声、動画、ドキュメント対応）
- **分離されたグループコンテキスト** - 各グループは独自の `GEMINI.md` メモリ、分離されたファイルシステムを持ち、独自のコンテナサンドボックスで実行
- **メインチャンネル** - 管理制御用のプライベートチャンネル；他のグループは完全に分離
- **スケジュールタスク** - Gemini を実行してメッセージを送信できる定期ジョブ
- **Web アクセス** - `agent-browser` によるブラウザ自動化で検索とコンテンツ取得
- **長期記憶** - 最近のアーカイブされた会話を自動的にコンテキストにロード（Gemini の 2M トークンウィンドウを活用）
- **コンテナ分離** - エージェントは Apple Container (macOS) または Docker (macOS/Linux) でサンドボックス化

## トラブルシューティング

| 問題 | 解決策 |
|------|--------|
| `container: command not found` | Apple Container または Docker をインストール |
| Bot が応答しない | Bot が管理者で Token が正しいことを確認 |
| `Gemini CLI not found` | `npm install -g @google/gemini-cli` を実行 |
| OAuth が失敗 | `gemini` を実行して再ログイン |

## ライセンス

MIT

## クレジット

- オリジナル [NanoClaw](https://github.com/gavrielc/nanoclaw) by [@gavrielc](https://github.com/gavrielc)
- Powered by [Gemini CLI](https://github.com/google-gemini/gemini-cli)
