// Buyer identification checks (ficha técnica SRI, tabla 6).
// Format errors block the document. Check-digit failures are only warnings: the SRI answers them with
// warnings 59/62 and some recent RUCs do not follow the classic check-digit algorithm.
export interface IdentificationCheck { error?: string; warning?: string }

const digits = (value: string) => [...value].map(Number);
function validProvince(id: string) {
  const province = Number(id.slice(0, 2));
  return (province >= 1 && province <= 24) || province === 30;
}
export function validCedula(id: string) {
  if (!/^\d{10}$/.test(id) || !validProvince(id) || Number(id[2]) >= 6) return false;
  const d = digits(id);
  const sum = d.slice(0, 9).reduce((total, n, i) => { const p = n * (i % 2 === 0 ? 2 : 1); return total + (p > 9 ? p - 9 : p); }, 0);
  return (10 - (sum % 10)) % 10 === d[9];
}
function modulo11(values: number[], weights: number[], check: number) {
  const rest = values.reduce((total, n, i) => total + n * weights[i], 0) % 11;
  const expected = rest === 0 ? 0 : 11 - rest;
  return expected !== 10 && expected === check;
}
export function validRuc(id: string) {
  if (!/^\d{13}$/.test(id) || !validProvince(id)) return false;
  const d = digits(id), third = d[2];
  if (third < 6) return validCedula(id.slice(0, 10)) && id.slice(10) !== "000";
  if (third === 6) return modulo11(d.slice(0, 8), [3, 2, 7, 6, 5, 4, 3, 2], d[8]) && id.slice(9) !== "0000";
  if (third === 9) return modulo11(d.slice(0, 9), [4, 3, 2, 7, 6, 5, 4, 3, 2], d[9]) && id.slice(10) !== "000";
  return false;
}
export function checkIdentification(type: string, id: string): IdentificationCheck {
  if (type === "04") {
    if (!/^\d{13}$/.test(id)) return { error: "El RUC del comprador debe tener 13 dígitos." };
    return validRuc(id) ? {} : { warning: "El RUC no supera la verificación de dígito. Confírmalo en el SRI antes de emitir." };
  }
  if (type === "05") {
    if (!/^\d{10}$/.test(id)) return { error: "La cédula del comprador debe tener 10 dígitos." };
    return validCedula(id) ? {} : { warning: "La cédula no supera la verificación de dígito. Confírmala antes de emitir." };
  }
  if (type === "06") return /^[A-Za-z0-9]{3,20}$/.test(id) ? {} : { error: "El pasaporte debe tener entre 3 y 20 letras o números, sin espacios." };
  return { error: "Tipo de identificación no admitido para este comprobante." };
}
