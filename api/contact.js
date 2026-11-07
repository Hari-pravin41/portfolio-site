// Vercel Function: POST /api/contact -> sends email via SMTP (no dependencies).
const net = require("net");
const tls = require("tls");

const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]{2,}$/;
const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const line = (v, n) => String(v || "").replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, n);
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const wrap76 = (s) => s.replace(/(.{76})/g, "$1\r\n");
const mimeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const quoteName = (s) => `"${s.replace(/["\\]/g, "")}"`;

function smtpSend({ host, port, secure, user, pass, from, to, raw }) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.setTimeout(15000, () => done(new Error("SMTP timeout")));
    let buf = "", waiter = null, finished = false;
    const done = (err) => {
      if (finished) return;
      finished = true;
      try { sock.destroy(); } catch (_) {}
      err ? reject(err) : resolve();
    };
    sock.on("error", done);
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      const lines = buf.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) && waiter) {
          const code = +lines[i].slice(0, 3), w = waiter;
          waiter = null; buf = lines.slice(i + 1).join("\r\n");
          return w(code, lines[i]);
        }
      }
    });
    const expect = (ok) => new Promise((res, rej) => {
      waiter = (code, text) => (ok.includes(code) ? res() : rej(new Error("SMTP " + text)));
    });
    const cmd = async (c, ok) => { sock.write(c + "\r\n"); await expect(ok); };
    (async () => {
      await expect([220]);
      await cmd("EHLO portfolio.local", [250]);
      await cmd("AUTH LOGIN", [334]);
      await cmd(b64(user), [334]);
      await cmd(b64(pass), [235]);
      await cmd(`MAIL FROM:<${from}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd("DATA", [354]);
      await cmd(raw.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..") + "\r\n.", [250]);
      sock.write("QUIT\r\n");
      done();
    })().catch(done);
  });
}

const core = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Use POST." });

  let data;
  try { data = JSON.parse(event.body || ""); } catch (_) { data = null; }
  if (!data || typeof data !== "object") return json(400, { ok: false, error: "Send JSON with name, email and message." });

  if (String(data.website || "").trim()) return json(200, { ok: true }); // honeypot

  const name = line(data.name, 100);
  const email = line(data.email, 200);
  const message = String(data.message || "").replace(/\x00/g, "").trim();
  if (name.length < 2) return json(422, { ok: false, error: "Please enter your name." });
  if (!EMAIL_RE.test(email)) return json(422, { ok: false, error: "Please enter a valid email address." });
  if (message.length < 10) return json(422, { ok: false, error: "Message is too short (minimum 10 characters)." });
  if (message.length > 4000) return json(422, { ok: false, error: "Message is too long (maximum 4000 characters)." });

  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASSWORD;
  const to = process.env.CONTACT_TO || user;
  if (!user || !pass) return json(503, { ok: false, error: "Email service is not configured on the server." });

  const port = +(process.env.SMTP_PORT || 465);
  const raw = [
    `From: ${quoteName("Portfolio Contact")} <${user}>`,
    `To: ${to}`,
    `Reply-To: ${/^[\x20-\x7e]*$/.test(name) ? quoteName(name) : mimeWord(name)} <${email}>`,
    `Subject: ${mimeWord("Portfolio contact: " + name)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(`Name:  ${name}\nEmail: ${email}\n\n${message}\n`)),
  ].join("\r\n");

  try {
    await smtpSend({
      host: process.env.SMTP_HOST || "smtp.gmail.com", port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== "false" : port === 465,
      user, pass, from: user, to, raw,
    });
  } catch (e) {
    console.error("contact email failed:", e.message);
    return json(502, { ok: false, error: "Could not send your message right now. Please email me directly." });
  }
  return json(200, { ok: true, message: "Thanks! Your message has been sent." });
};

module.exports = async (req, res) => {
  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || "");
  const r = await core({ httpMethod: req.method, body });
  res.status(r.statusCode).setHeader("Content-Type", "application/json");
  res.send(r.body);
};
