
import { getStore } from "@netlify/blobs";

const store = getStore("telegram-orders");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_CHAT_ID || "");
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";

const API = `https://api.telegram.org/bot${TOKEN}`;

async function telegram(method, data) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  const result = await response.json();

  if (!result.ok) {
    throw new Error(result.description || "Telegram API error");
  }

  return result.result;
}

async function send(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra
  });
}

async function getOrder(id) {
  return store.get(`orders/${id}`, { type: "json" });
}

async function saveOrder(order) {
  await store.setJSON(`orders/${order.id}`, order);
}

async function updateStatus(id, status) {
  const order = await getOrder(id);
  if (!order) return null;

  order.status = status;
  order.updatedAt = new Date().toISOString();

  await saveOrder(order);
  return order;
}

async function handleMessage(message) {
  const chatId = String(message.chat.id);
  const text = (message.text || "").trim();
  const userKey = `users/${chatId}`;

  if (!text) return;

  if (text === "/myid") {
    await send(chatId, `Your Telegram ID: ${chatId}`);
    return;
  }

  if (text === "/start" || text === "/help") {
    await send(
      chatId,
      "👋 Welcome to our Order Bot!\n\n" +
      "📦 /order - Place a new order\n" +
      "🔎 /status ID - Check your order\n" +
      "❓ /help - Help\n\n" +
      "We are happy to serve you!"
    );
    return;
  }

  if (text === "/order") {
    await store.setJSON(userKey, { step: "name" });
    await send(chatId, "🛍️ Let's place your order!\n\nPlease enter your full name:");
    return;
  }

  if (text.startsWith("/status")) {
    const id = text.split(/\s+/)[1];

    if (!id) {
      await send(chatId, "Use this format:\n/status ORDER_ID");
      return;
    }

    const order = await getOrder(id);

    if (!order || String(order.chatId) !== chatId) {
      await send(chatId, "❌ Order not found.");
      return;
    }

    await send(
      chatId,
      `📦 Order: ${order.id}\n` +
      `Product: ${order.product}\n` +
      `Quantity: ${order.quantity}\n` +
      `Status: ${order.status}`
    );
    return;
  }

  // Admin command: list recent orders
  if (text === "/orders" && chatId === ADMIN_ID) {
    const { blobs } = await store.list({ prefix: "orders/" });
    const recent = blobs.slice(-15).reverse();

    if (!recent.length) {
      await send(chatId, "No orders yet.");
      return;
    }

    for (const item of recent) {
      const order = await getOrder(item.key.replace("orders/", ""));
      if (order) {
        await send(
          chatId,
          `📦 ${order.id}\n${order.customer}\n${order.product}\n` +
          `Status: ${order.status}`
        );
      }
    }
    return;
  }

  const state = await store.get(userKey, { type: "json" });

  if (!state) {
    await send(chatId, "Please type /start or /order to begin.");
    return;
  }

  if (state.step === "name") {
    state.customer = text;
    state.step = "phone";
    await store.setJSON(userKey, state);
    await send(chatId, "📱 Please enter your phone number:");
    return;
  }

  if (state.step === "phone") {
    state.phone = text;
    state.step = "product";
    await store.setJSON(userKey, state);
    await send(chatId, "🛒 What product would you like to order?");
    return;
  }

  if (state.step === "product") {
    state.product = text;
    state.step = "quantity";
    await store.setJSON(userKey, state);
    await send(chatId, "🔢 Enter the quantity:");
    return;
  }

  if (state.step === "quantity") {
    const quantity = Number(text);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      await send(chatId, "Please enter a valid quantity (a positive whole number).");
      return;
    }

    state.quantity = quantity;
    state.step = "address";
    await store.setJSON(userKey, state);
    await send(chatId, "📍 Enter your delivery address:");
    return;
  }

  if (state.step === "address") {
    state.address = text;

    const id = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const order = {
      id,
      chatId,
      customer: state.customer,
      phone: state.phone,
      product: state.product,
      quantity: state.quantity,
      address: state.address,
      status: "Pending",
      createdAt: new Date().toISOString()
    };

    await saveOrder(order);
    await store.delete(userKey);

    await send(
      chatId,
      `✅ Your order has been received!\n\n` +
      `🆔 Order ID: ${id}\n` +
      `👤 Name: ${order.customer}\n` +
      `📦 Product: ${order.product}\n` +
      `🔢 Quantity: ${order.quantity}\n` +
      `📍 Address: ${order.address}\n` +
      `📌 Status: Pending\n\n` +
      `Use /status ${id} to track your order.`
    );

    if (ADMIN_ID) {
      await send(
        ADMIN_ID,
        `🔔 NEW ORDER!\n\n` +
        `🆔 ${id}\n` +
        `👤 ${order.customer}\n` +
        `📱 ${order.phone}\n` +
        `📦 ${order.product}\n` +
        `🔢 Quantity: ${order.quantity}\n` +
        `📍 ${order.address}\n\n` +
        `Choose an action:`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `order:approve:${id}` },
                { text: "❌ Reject", callback_data: `order:reject:${id}` }
              ],
              [
                { text: "📦 Complete", callback_data: `order:complete:${id}` }
              ]
            ]
          }
        }
      );
    }
    return;
  }

  await send(chatId, "Please type /order to start a new order.");
}

async function handleCallback(query) {
  const chatId = String(query.message?.chat?.id || "");

  if (!ADMIN_ID || chatId !== ADMIN_ID) {
    await telegram("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Unauthorized",
      show_alert: true
    });
    return;
  }

  const parts = (query.data || "").split(":");
  const action = parts[1];
  const id = parts[2];

  const statuses = {
    approve: "Approved",
    reject: "Rejected",
    complete: "Completed"
  };

  if (!statuses[action] || !id) return;

  const order = await updateStatus(id, statuses[action]);

  if (!order) {
    await telegram("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Order not found",
      show_alert: true
    });
    return;
  }

  await telegram("answerCallbackQuery", {
    callback_query_id: query.id,
    text: `Order ${statuses[action]}`
  });

  await send(
    order.chatId,
    `📦 Your order ${id} status has been updated:\n\n` +
    `Status: ${statuses[action]}`
  );

  await send(chatId, `✅ Order ${id} is now ${statuses[action]}.`);
}

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!TOKEN) {
    return new Response("Bot token is not configured", { status: 500 });
  }

  if (
    WEBHOOK_SECRET &&
    request.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = await request.json();

    // Prevent processing the same Telegram update twice.
    if (update.update_id !== undefined) {
      const result = await store.set(
        `updates/${update.update_id}`,
        "processed",
        { onlyIfNew: true }
      );

      if (!result.modified) {
        return new Response("OK", { status: 200 });
      }
    }

    if (update.message) {
      await handleMessage(update.message);
    }

    if (update.callback_query) {
      await handleCallback(update.callback_query);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Telegram bot error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
