import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Prevent caching

export async function GET() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return NextResponse.json({ error: 'Missing Twilio credentials' }, { status: 500 });
  }

  try {
    // Twilio API to generate short-lived TURN tokens
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
        }
      }
    );

    if (!response.ok) throw new Error('Failed to fetch ICE servers');

    const data = await response.json();
    return NextResponse.json({ iceServers: data.ice_servers });
  } catch (error) {
    console.error('ICE Token Error:', error);
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 });
  }
}
