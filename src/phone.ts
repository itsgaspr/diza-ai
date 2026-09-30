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

export function phoneFromUserJid(jid: string | null | undefined): string | null {
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
  const user = jid.split("@")[0]?.split(":")[0] ?? "";
  const only = digits(user);
  return only || null;
}
