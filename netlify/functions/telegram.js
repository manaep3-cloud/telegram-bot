
export default async (req) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      return new Response("Token missing", {
        status: 500
      });
    }

    const update = await req.json();
    const message = update.message;

    if (!message?.chat?.id) {
      return new Response("OK");
    }

    const chatId = message.chat.id;
    const userText = message.text || "";

    const reply = userText
      ? `ሰላም! 😊\nመልዕክትህን ተቀብያለሁ፦ ${userText}`
      : "ሰላም! 😊 እንኳን ወደ Bot በደህና መጣህ።";

    await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: reply
        })
      }
    );

    return new Response("OK");
  } catch (error) {
    return new Response("Error", {
      status: 500
    });
  }
};
