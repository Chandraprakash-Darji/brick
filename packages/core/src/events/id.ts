const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newEventId(now: number = Date.now()): string {
  let time = "";
  let remaining = now;
  for (let index = 0; index < 10; index++) {
    time = ALPHABET[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  let random = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
    random += ALPHABET[byte % 32];
  }
  return `evt_${time}${random}`;
}
