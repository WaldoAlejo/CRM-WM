// Único lugar del código que decide QUÉ adaptador usar. El resto de la app
// (services, controllers) siempre importa `rucValidationService` desde aquí,
// nunca un adaptador concreto directamente. Cambiar de proveedor en el
// futuro es reemplazar esta línea, nada más.
import { HttpRucValidationAdapter } from "./httpRucValidationAdapter";
import type { RucValidationService } from "./ruc-validation.types";

export const rucValidationService: RucValidationService = new HttpRucValidationAdapter();

export type { RucValidationResult, RucValidationService } from "./ruc-validation.types";
