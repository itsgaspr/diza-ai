export function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export function phonesMatch(left: string, right: string): boolean {
  const a = digits(left);
  const b = digits(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.length >= 8 && longer.endsWith(shorter);
}

export function phoneFromMessageKey(key: {
  participantAlt?: string | null;
  participant?: string | null;
  remoteJidAlt?: string | null;
  remoteJid?: string | null;
}): string | null {
  const jid = key.participantAlt || key.participant || key.remoteJidAlt || key.remoteJid;
  return phoneFromUserJid(jid);
}

export function phoneFromUserJid(jid: string | null | undefined): string | null {
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
  const user = jid.split("@")[0]?.split(":")[0] ?? "";
  const only = digits(user);
  return only || null;
}

export function lidAliases(value: string): string[] {
  const user = digits(value.split("@")[0]?.split(":")[0] ?? "");
  if (!user) return [];
  return [...new Set([value, user, `${user}@lid`])];
}

export function rememberLidPhone(map: Map<string, string>, lid: string, phone: string): void {
  const only = phoneFromUserJid(phone) ?? (phone.includes("@") ? "" : digits(phone));
  if (only.length < 8 || only.length > 15) return;
  for (const key of lidAliases(lid)) map.set(key, only);
}

export function phoneForLid(map: ReadonlyMap<string, string>, lid: string): string | null {
  for (const key of lidAliases(lid)) {
    const found = map.get(key);
    if (found) return found;
  }
  return null;
}
