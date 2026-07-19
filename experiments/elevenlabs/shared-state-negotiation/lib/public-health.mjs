import https from "node:https";

function httpsJsonViaAddress(url, address, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: { accept: "application/json" },
        lookup(_hostname, options, callback) {
          if (options?.all) {
            callback(null, [{ address, family: 4 }]);
          } else {
            callback(null, address, 4);
          }
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {}
          resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, body });
        });
      },
    );
    request.once("timeout", () => request.destroy(new Error("HTTPS request timed out")));
    request.once("error", reject);
  });
}

async function publicIpv4Addresses(hostname, timeoutMs) {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok) throw new Error(`DNS-over-HTTPS returned HTTP ${response.status}`);
  const result = await response.json();
  return [...new Set(
    (result.Answer ?? [])
      .filter((answer) => answer.type === 1 && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(answer.data))
      .map((answer) => answer.data),
  )];
}

export async function getPublicJson(url, timeoutMs = 4_000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
      resolver: "system",
    };
  } catch (systemError) {
    const hostname = new URL(url).hostname;
    const addresses = await publicIpv4Addresses(hostname, timeoutMs);
    if (addresses.length === 0) {
      throw new Error(`System DNS failed (${systemError.message}); public DNS returned no IPv4 address.`);
    }

    let lastError = systemError;
    for (const address of addresses) {
      try {
        return {
          ...(await httpsJsonViaAddress(url, address, timeoutMs)),
          resolver: `dns-over-https:${address}`,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Public HTTPS request failed through every resolved address: ${lastError.message}`);
  }
}
