import {
  createBrickClient,
  type BrickClientSocket,
} from "@brickkit/core/client";
import { contract } from "../_brick/contract";
import FingerprintJS from "@fingerprintjs/fingerprintjs";
import { icons, svgIcon } from "./icons";

for (const element of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const name = element.dataset.icon;
  if (name && Object.hasOwn(icons, name))
    element.innerHTML = svgIcon(icons[name as keyof typeof icons]);
}

type SocketOutput<T> =
  T extends BrickClientSocket<unknown, infer Output> ? Output : never;
type ChatMessage = SocketOutput<typeof contract.chat.live>["message"];

const api = createBrickClient({ baseUrl: location.origin, contract });
const join = document.querySelector<HTMLButtonElement>("#join")!;
const leave = document.querySelector<HTMLButtonElement>("#leave")!;
const send = document.querySelector<HTMLButtonElement>("#send")!;
const input = document.querySelector<HTMLTextAreaElement>("#message")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const connection = document.querySelector<HTMLSpanElement>("#connection")!;
const presence = document.querySelector<HTMLSpanElement>("#presence")!;
const transport = document.querySelector<HTMLSpanElement>("#transport")!;
const transportDot = document.querySelector<HTMLSpanElement>("#transport-dot")!;
const conversation = document.querySelector<HTMLDivElement>("#conversation")!;
const messages = document.querySelector<HTMLDivElement>("#messages")!;
const welcome = document.querySelector<HTMLElement>("#welcome")!;
const form = document.querySelector<HTMLFormElement>("#composer")!;
let live: ReturnType<typeof api.chat.live.connect> | undefined;
let currentUserId = "";
let received = 0;
const rendered = new Set<number>();
let fingerprintAgent: ReturnType<typeof FingerprintJS.load> | undefined;
let lastError = "";

function connected(online: boolean) {
  connection.innerHTML = `<span></span>${online ? "Live" : "Offline"}`;
  connection.classList.toggle("online", online);
  transportDot.classList.toggle("online", online);
  join.hidden = online;
  join.disabled = false;
  leave.hidden = !online;
  input.disabled = !online;
  send.disabled = !online || !input.value.trim();
  if (!online) {
    presence.hidden = true;
    transport.textContent = "Connection closed";
  }
}

function renderMessage({
  id,
  userId,
  name: senderName,
  text,
  at,
}: ChatMessage) {
  welcome.hidden = true;
  if (rendered.has(id)) return;
  rendered.add(id);
  const own = userId === currentUserId;
  const row = document.createElement("article");
  row.className = `message${own ? " own" : ""}`;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = own ? "Y" : "G";
  avatar.setAttribute("aria-hidden", "true");
  const content = document.createElement("div");
  content.className = "message-content";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("strong");
  name.textContent = own ? "You" : senderName;
  const time = document.createElement("time");
  time.dateTime = at;
  time.title = new Date(at).toLocaleString();
  time.textContent = new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  meta.append(name, time);
  content.append(meta, bubble);
  if (own) {
    const delivered = document.createElement("div");
    delivered.className = "delivered";
    delivered.textContent = "✓ Saved";
    content.append(delivered);
  }
  row.append(avatar, content);
  messages.append(row);
  conversation.scrollTop = conversation.scrollHeight;
  received++;
  transport.textContent = `WebSocket connected. ${received} ${received === 1 ? "message" : "messages"} received`;
}

join.onclick = async () => {
  join.disabled = true;
  status.classList.remove("error");
  status.textContent = "Opening your connection…";
  lastError = "";
  try {
    status.textContent = "Identifying this browser…";
    fingerprintAgent ??= FingerprintJS.load({ monitoring: false });
    const { visitorId } = await (await fingerprintAgent).get();
    const session = await fetch("/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint: visitorId }),
    });
    if (!session.ok) throw new Error("Could not create a demo session");
    const socket = api.chat.live.connect({ timeoutMs: 5000 });
    live = socket;
    socket.on("connected", ({ id }) => {
      if (currentUserId !== id) {
        messages.replaceChildren();
        rendered.clear();
        received = 0;
      }
      currentUserId = id;
      status.textContent = "Loading saved conversation…";
      transport.textContent = "WebSocket connected. Waiting for a message.";
    });
    socket.on("presence", ({ count }) => {
      presence.hidden = false;
      presence.textContent = `${count} ${count === 1 ? "connection" : "connections"} live`;
    });
    socket.on("message", renderMessage);
    socket.on("history", ({ messages: history, done }) => {
      for (const message of history) renderMessage(message);
      if (done)
        status.textContent =
          "Conversation ready. Messages are saved automatically.";
    });
    socket.onError((error) => {
      lastError = error.message;
    });
    socket.onClose(({ code }) => {
      connected(false);
      status.textContent =
        lastError || "Disconnected. Join the conversation to continue.";
      status.classList.toggle("error", !!lastError || code !== 1000);
    });
    await socket.ready;
    connected(true);
    input.focus();
  } catch (error) {
    connected(false);
    status.classList.add("error");
    status.textContent =
      error instanceof Error
        ? error.message
        : "Could not connect. Try joining again.";
  }
};
leave.onclick = () => live?.close();
input.oninput = () => {
  send.disabled = input.disabled || !input.value.trim();
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
};
input.onkeydown = (event) => {
  if (event.isComposing) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!send.disabled) form.requestSubmit();
  }
};
form.onsubmit = (event) => {
  event.preventDefault();
  if (!live || !input.value.trim() || send.disabled) return;
  try {
    live.send("say", { text: input.value.trim() });
    input.value = "";
    input.style.height = "auto";
    send.disabled = true;
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "Message could not be sent";
    status.classList.add("error");
  }
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-prompt]",
)) {
  button.onclick = () => {
    input.value = button.dataset.prompt ?? "";
    input.dispatchEvent(new Event("input"));
    if (input.disabled) join.focus();
    else input.focus();
  };
}
document.querySelector<HTMLButtonElement>("#invite")!.onclick = () =>
  window.open(location.href, "_blank", "noopener");
window.addEventListener("pagehide", () => live?.close());
