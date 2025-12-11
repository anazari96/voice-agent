# Voice Agent Project

This project implements a Realtime Voice Agent using Node.js, Twilio, Deepgram, OpenAI, and ElevenLabs. It includes a dashboard to manage business context stored in Supabase.

## Architecture

- **Backend**: Node.js + Express + WebSocket (`src/index.ts`)
- **Voice Pipeline**: Twilio Media Streams -> Deepgram (STT) -> OpenAI (Logic) -> ElevenLabs (TTS) -> Twilio
- **Database**: Supabase (Business Info)
- **External API**: Clover (Product Data)
- **Frontend**: React + Vite (`client/`)

## Setup

1.  **Install Backend Dependencies**:
    ```bash
    npm install
    ```

2.  **Install Frontend Dependencies**:
    ```bash
    cd client
    npm install
    ```

3.  **Environment Variables**:
    Create a `.env` file in the root directory (see `.env.example` - wait, I couldn't create it, so here is the list):
    ```env
    PORT=3000
    SUPABASE_URL=your_supabase_url
    SUPABASE_KEY=your_supabase_anon_key
    CLOVER_API_URL=https://api.clover.com
    CLOVER_API_KEY=your_clover_api_token
    CLOVER_MERCHANT_ID=your_merchant_id
    OPENAI_API_KEY=your_openai_api_key
    DEEPGRAM_API_KEY=your_deepgram_api_key
    ELEVENLABS_API_KEY=your_elevenlabs_api_key
    ELEVENLABS_VOICE_ID=your_voice_id
    TWILIO_ACCOUNT_SID=your_twilio_sid
    TWILIO_AUTH_TOKEN=your_twilio_token
    ```

4.  **Supabase Setup**:
    - Create a project.
    - Run the SQL in `src/db/schema.sql` in the Supabase SQL Editor.
    - Get your URL and Anon Key.

5.  **Running the Project**:

    - **Backend**:
      ```bash
      npm run dev
      ```
    - **Frontend**:
      ```bash
      cd client
      npm run dev
      ```

6.  **Twilio Setup**:
    - Buy a phone number.
    - Set the Voice Webhook to `POST https://YOUR_DOMAIN/voice`.
    - If running locally, use `ngrok http 3000` to get a public URL.

## Features

- **Realtime Voice**: Low latency voice interaction.
- **Dynamic Context**: Loads business info from Supabase and products from Clover at the start of every call.
- **Dashboard**: Simple UI to update business instructions.

