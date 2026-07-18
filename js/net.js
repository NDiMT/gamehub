// Δικτύωση: ο host είναι authoritative. Τρία transports με κοινό interface:
//  - LoopbackTransport: σόλο (χωρίς δίκτυο)
//  - BroadcastTransport: 2+ tabs στον ίδιο browser (τοπικό testing)
//  - PeerTransport: πραγματικό P2P μέσω PeerJS (παίκτες σε δικά τους κινητά)
//
// Interface:
//   host(roomCode): onGuestJoin(cb), onCommand(cb), broadcast(msg)
//   join(roomCode): onState(cb), send(msg), onClosed(cb)

const PREFIX = "cryptbound-v1-";

export function makeRoomCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // χωρίς Ι/Ο/0/1
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

// ---------- Loopback (σόλο) ----------
export function loopbackTransport() {
  return {
    kind: "loopback",
    async hostRoom() { return { onGuestJoin() {}, onCommand() {}, broadcast() {}, close() {} }; },
    async joinRoom() { throw new Error("loopback δεν κάνει join"); },
  };
}

// ---------- BroadcastChannel (testing σε tabs) ----------
export function broadcastTransport() {
  return {
    kind: "broadcast",
    async hostRoom(code) {
      const ch = new BroadcastChannel(PREFIX + code);
      const handlers = { join: [], command: [] };
      ch.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "hello") handlers.join.forEach((cb) => cb(msg));
        else if (msg.type === "command") handlers.command.forEach((cb) => cb(msg));
      };
      return {
        onGuestJoin: (cb) => handlers.join.push(cb),
        onCommand: (cb) => handlers.command.push(cb),
        broadcast: (msg) => ch.postMessage(msg),
        close: () => ch.close(),
      };
    },
    async joinRoom(code) {
      const ch = new BroadcastChannel(PREFIX + code);
      const handlers = { state: [], closed: [] };
      ch.onmessage = (e) => {
        if (e.data.type === "state" || e.data.type === "lobby") handlers.state.forEach((cb) => cb(e.data));
      };
      return {
        onState: (cb) => handlers.state.push(cb),
        onClosed: (cb) => handlers.closed.push(cb),
        send: (msg) => ch.postMessage(msg),
        close: () => ch.close(),
      };
    },
  };
}

// ---------- PeerJS (production) ----------
export function peerTransport() {
  const Peer = window.Peer;
  return {
    kind: "peer",
    async hostRoom(code) {
      const peer = new Peer(PREFIX + code, { debug: 0 });
      await new Promise((resolve, reject) => {
        peer.on("open", resolve);
        peer.on("error", (e) => reject(new Error("Peer error: " + e.type)));
        setTimeout(() => reject(new Error("Timeout σύνδεσης στο δίκτυο")), 12000);
      });
      const conns = new Set();
      const handlers = { join: [], command: [] };
      peer.on("connection", (conn) => {
        conn.on("open", () => conns.add(conn));
        conn.on("close", () => conns.delete(conn));
        conn.on("data", (msg) => {
          if (msg.type === "hello") handlers.join.forEach((cb) => cb(msg, conn));
          else if (msg.type === "command") handlers.command.forEach((cb) => cb(msg));
        });
      });
      return {
        onGuestJoin: (cb) => handlers.join.push(cb),
        onCommand: (cb) => handlers.command.push(cb),
        broadcast: (msg) => conns.forEach((c) => c.open && c.send(msg)),
        close: () => peer.destroy(),
      };
    },
    async joinRoom(code) {
      const peer = new Peer({ debug: 0 });
      await new Promise((resolve, reject) => {
        peer.on("open", resolve);
        peer.on("error", (e) => reject(new Error("Peer error: " + e.type)));
        setTimeout(() => reject(new Error("Timeout σύνδεσης στο δίκτυο")), 12000);
      });
      const conn = peer.connect(PREFIX + code, { reliable: true });
      await new Promise((resolve, reject) => {
        conn.on("open", resolve);
        conn.on("error", reject);
        setTimeout(() => reject(new Error("Δεν βρέθηκε δωμάτιο " + code)), 12000);
      });
      const handlers = { state: [], closed: [] };
      conn.on("data", (msg) => {
        if (msg.type === "state" || msg.type === "lobby") handlers.state.forEach((cb) => cb(msg));
      });
      conn.on("close", () => handlers.closed.forEach((cb) => cb()));
      return {
        onState: (cb) => handlers.state.push(cb),
        onClosed: (cb) => handlers.closed.push(cb),
        send: (msg) => conn.send(msg),
        close: () => peer.destroy(),
      };
    },
  };
}

// Επιλογή transport: ?net=bc για BroadcastChannel (testing), αλλιώς PeerJS.
export function pickTransport() {
  const param = new URLSearchParams(location.search).get("net");
  if (param === "bc") return broadcastTransport();
  return peerTransport();
}
