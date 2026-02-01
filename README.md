🚨 SafeAlert: A Web-Based Human Monitoring System with Perimeter Detection.
SafeAlert transforms any browser-enabled device into an intelligent security hub using real-time object detection. It establishes a secure 1-to-1 link between a Dependent (Camera) and a Guardian (Monitor) to provide automated perimeter security and instant emergency communication.

https://safealert-1s9g9i2b5-safealert.vercel.app

✨ Key Features
- Real-time human detection and perimeter breach monitoring via YOLO.
- Emergency SOS: Client-side panic button with a 5-second confirmation countdown.
- Real-time Alerts: Instant breach notifications powered by Supabase Realtime.
- Privacy Control: Clients can toggle camera access or revoke Admin links instantly.

🛠️ Tech Stack
Frontend: Next.js (App Router), TypeScript, Tailwind CSS

Backend: Supabase (Auth, Database, Realtime)

AI/CV: YOLO (TensorFlow.js / ONNX)

Streaming: WebRTC / MediaStream API

📋 Quick Setup
Clone & Install:
Bash
git clone https://github.com/your-username/safealert.git
cd safealert && npm install
Environment Variables: Add your NEXT_PUBLIC_SUPABASE_URL and ANON_KEY to .env.local.

Launch:
Bash
npm run dev
🚶 User Flow
Client: Logs in, generates a unique QR Code, and awaits pairing.
Admin: Scans the Client's QR code to lock the 1-to-1 connection.
Monitor: Admin sets perimeter lines; Client streams video.
Alert: System triggers instant notifications for breaches or manual SOS hits.
