// shippingProvince es texto libre en el backend (sin enum — ver
// dispatchOrders.schemas.ts), pero el listado de órdenes filtra por
// coincidencia EXACTA de ese texto: un <select> fijo evita que "Guayas" y
// "guayas" (o un typo) terminen siendo, para el filtro, dos provincias
// distintas. Lista estática de las 24 provincias del Ecuador.
export const ECUADOR_PROVINCES = [
  "Azuay",
  "Bolívar",
  "Cañar",
  "Carchi",
  "Chimborazo",
  "Cotopaxi",
  "El Oro",
  "Esmeraldas",
  "Galápagos",
  "Guayas",
  "Imbabura",
  "Loja",
  "Los Ríos",
  "Manabí",
  "Morona Santiago",
  "Napo",
  "Orellana",
  "Pastaza",
  "Pichincha",
  "Santa Elena",
  "Santo Domingo de los Tsáchilas",
  "Sucumbíos",
  "Tungurahua",
  "Zamora Chinchipe",
] as const;
