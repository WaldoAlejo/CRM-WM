// Abstracción del servicio de validación de RUC. El resto del código nunca
// debe importar un proveedor específico (ApiConsult, EcuadorAPI, etc.)
// directamente: siempre pasa por esta interfaz, así se puede cambiar de
// proveedor después reemplazando solo el adaptador (ver index.ts).

export interface RucValidationResult {
  // false si el proveedor no encontró el RUC, o si la consulta falló/no
  // respondió (timeout, error de red, credenciales, etc.). Un `found: false`
  // NUNCA debe bloquear el registro del mayorista: solo significa que no hay
  // autocompletado disponible y el usuario carga los datos a mano.
  found: boolean;
  businessName?: string;
  taxStatus?: string; // Estado tributario tal cual lo devuelve el proveedor (ej: "ACTIVO", "SUSPENDIDO").
  raw: unknown; // Respuesta cruda del proveedor, para guardarla como auditoría.
}

export interface RucValidationService {
  // Nunca debe lanzar una excepción: cualquier fallo (red, timeout, proveedor
  // caído, credenciales inválidas) se atrapa dentro del adaptador y se
  // devuelve como `{ found: false, raw: <detalle del error> }`.
  validate(ruc: string): Promise<RucValidationResult>;
}
