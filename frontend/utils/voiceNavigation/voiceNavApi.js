const BASE = "/api/indoor";

export async function matchDestination(query, options = {}) {
  const res = await fetch(`${BASE}/match-destination`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, ...options })
  });
  return res.json();
}

export async function matchClarification(query, candidates) {
  const res = await fetch(`${BASE}/match-clarification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, candidates })
  });
  return res.json();
}

export async function classifyEnvironment(evidence) {
  const res = await fetch(`${BASE}/classify-environment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ evidence })
  });
  const data = await res.json();
  return data.result;
}

export async function localize(payload) {
  const res = await fetch(`${BASE}/localize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.json();
}
