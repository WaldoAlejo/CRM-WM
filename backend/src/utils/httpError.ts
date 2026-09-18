// Error con código HTTP asociado. Se lanza en los services y el
// errorHandler central lo convierte en la respuesta JSON correspondiente.
// `details` es opcional: permite adjuntar datos extra a la respuesta (ej: qué
// campo exacto violó una restricción única) sin crear una subclase por caso.
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new HttpError(400, message, details);
export const unauthorized = (message = "No autenticado") => new HttpError(401, message);
export const forbidden = (message = "No tienes permiso para esta acción") =>
  new HttpError(403, message);
export const notFound = (message = "No encontrado") => new HttpError(404, message);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new HttpError(409, message, details);
export const unprocessableEntity = (message: string, details?: Record<string, unknown>) =>
  new HttpError(422, message, details);
