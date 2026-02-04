<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoGemClaw" width="400">
</p>

<p align="center">
  Asistente de IA personal impulsado por <strong>Gemini CLI</strong>. Se ejecuta de forma segura en contenedores. Ligero y fácil de entender y personalizar.
</p>

<p align="center">
  <em>Fork de <a href="https://github.com/gavrielc/nanoclaw">NanoClaw</a> - Claude Agent SDK reemplazado por Gemini CLI, WhatsApp por Telegram</em>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <strong>Español</strong> |
  <a href="README.ja.md">日本語</a>
</p>

## ¿Por qué NanoGemClaw?

**NanoGemClaw** es un fork de [NanoClaw](https://github.com/gavrielc/nanoclaw) que reemplaza Claude Agent SDK con **Gemini CLI** y WhatsApp con **Telegram**:

| Característica | NanoClaw | NanoGemClaw |
|----------------|----------|-------------|
| **Runtime del Agente** | Claude Agent SDK | Gemini CLI |
| **Mensajería** | WhatsApp (Baileys) | Telegram Bot API |
| **Costo** | Claude Max ($100/mes) | Nivel gratuito (60 req/min) |
| **Archivo de Memoria** | CLAUDE.md | GEMINI.md |
| **Modelo** | Claude 3.5 Sonnet | Gemini 2.5 Pro/Flash |
| **Soporte Multimedia** | Solo texto | Foto, Voz, Audio, Video, Documento |

La misma arquitectura de aislamiento en contenedores. Diferente backend de IA.

---

## 🚀 Inicio Rápido

### Requisitos Previos

| Herramienta | Propósito | Instalación |
|-------------|-----------|-------------|
| **Node.js 20+** | Ejecuta el proceso principal | [nodejs.org](https://nodejs.org) |
| **Gemini CLI** | Núcleo del Agente IA | `npm install -g @google/gemini-cli` |
| **Runtime de Contenedor** | Entorno sandbox | Ver abajo |

**Instalar Runtime de Contenedor (elige uno):**

```bash
# macOS - Apple Container (Recomendado)
brew install apple-container

# macOS/Linux - Docker
brew install --cask docker   # macOS
# O descargar desde https://docker.com
```

---

### Paso 1: Clonar Repositorio

```bash
git clone https://github.com/Rlin1027/NanoGemClaw.git
cd NanoGemClaw
npm install
```

---

### Paso 2: Crear Bot de Telegram

1. Busca **@BotFather** en Telegram
2. Envía `/newbot`
3. Sigue las instrucciones para nombrar tu bot
4. Copia el **Token** proporcionado por BotFather

```bash
# Crear archivo .env con tu Token
echo "TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz" > .env
```

---

### Paso 3: Verificar Token del Bot

```bash
npm run setup:telegram
```

Salida exitosa:

```
✓ Bot token is valid!
  Bot Username: @YourBotName
```

---

### Paso 4: Iniciar sesión en Gemini CLI (OAuth)

El primer uso requiere inicio de sesión con Google:

```bash
gemini
```

Sigue las instrucciones del terminal para completar el inicio de sesión OAuth. Las credenciales autenticadas se compartirán automáticamente con el contenedor.

> 💡 **Consejo**: Si prefieres usar una API Key, añade `GEMINI_API_KEY=your_key` a tu archivo `.env`.

---

### Paso 5: Construir Contenedor del Agente

```bash
cd container
./build.sh
cd ..
```

Esto construye la imagen `nanogemclaw-agent:latest` que contiene Gemini CLI y todas las herramientas necesarias.

---

### Paso 6: Configurar Grupo de Telegram

1. Añade tu Bot a un grupo de Telegram
2. **Promociona el Bot a Administrador** (Requerido para ver mensajes)
3. Anota el ID del Grupo (Puedes verlo en los logs después de enviar un mensaje al bot)

---

### Paso 7: Iniciar Servicio

```bash
npm run dev
```

Salida exitosa:

```
✓ NanoGemClaw running (trigger: @Andy)
  Bot: @YourBotName
  Registered groups: 0
```

---

### Paso 8: Registrar Grupo

Por primera vez, envía este comando en tu chat privado (1:1 con el Bot):

```
@Andy register this group as main
```

Esto establece el chat actual como el "Grupo Principal" con derechos de administrador completos.

Para añadir otros grupos después, envía esto desde el Grupo Principal:

```
@Andy join the "My Group Name" group
```

---

## ✅ ¡Listo

Ahora puedes chatear con tu asistente de IA en cualquier grupo registrado:

```
@Andy Hola
@Andy revisa el clima de hoy
@Andy recuérdame tener una reunión cada mañana a las 9am
```

---

## Funcionalidades

- **Telegram I/O** - Envía mensajes a Gemini desde tu teléfono (soporta foto, voz, video, documento)
- **Contexto de grupo aislado** - Cada grupo tiene su propia memoria `GEMINI.md`, sistema de archivos aislado y se ejecuta en su propio sandbox de contenedor
- **Canal principal** - Tu canal privado para control de administración; todos los demás grupos están completamente aislados
- **Tareas programadas** - Trabajos recurrentes que ejecutan Gemini y pueden enviarte mensajes
- **Acceso web** - Busca y obtén contenido con automatización del navegador (`agent-browser`)
- **Memoria a largo plazo** - Carga automáticamente conversaciones archivadas recientes en el contexto (utilizando la ventana de 2M tokens de Gemini)
- **Aislamiento en contenedor** - Agentes en sandbox en Apple Container (macOS) o Docker (macOS/Linux)

## Solución de Problemas

| Problema | Solución |
|----------|----------|
| `container: command not found` | Instala Apple Container o Docker |
| Bot no responde | Asegúrate de que el Bot sea Administrador y el Token sea correcto |
| `Gemini CLI not found` | Ejecuta `npm install -g @google/gemini-cli` |
| OAuth falló | Ejecuta `gemini` para iniciar sesión de nuevo |

## Licencia

MIT

## Créditos

- [NanoClaw](https://github.com/gavrielc/nanoclaw) original por [@gavrielc](https://github.com/gavrielc)
- Impulsado por [Gemini CLI](https://github.com/google-gemini/gemini-cli)
