// ============================================================================
// Seed inicial: crea datos de ejemplo para poder probar el sistema de
// inmediato (categorías, subcategorías, productos con variantes, un lote de
// importación y sus movimientos de ingreso).
//
// Es seguro correrlo varias veces (usa upsert / verificaciones), no duplica datos.
// Ejecutar con: npm run seed
// ============================================================================

import { MovementType, PriceType, PrismaClient, ProductStatus, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // --- Usuario administrador de ejemplo ---
  // Cambia esta contraseña en cuanto exista la pantalla de login real.
  const adminPasswordHash = await bcrypt.hash("Admin123!", 10);
  await prisma.user.upsert({
    where: { email: "admin@kestore.com.ec" },
    update: {},
    create: {
      email: "admin@kestore.com.ec",
      passwordHash: adminPasswordHash,
      name: "Administrador WM",
      role: Role.ADMIN,
    },
  });

  // --- Usuario operador de ejemplo (para probar las restricciones por rol) ---
  const operatorPasswordHash = await bcrypt.hash("Operador123!", 10);
  await prisma.user.upsert({
    where: { email: "operador@kestore.com.ec" },
    update: {},
    create: {
      email: "operador@kestore.com.ec",
      passwordHash: operatorPasswordHash,
      name: "Operador de Bodega",
      role: Role.OPERATOR,
    },
  });

  // --- Usuario CEO de ejemplo ---
  // Un CEO solo puede ser creado/modificado por otro CEO (ver módulo de
  // Usuarios), así que el PRIMERO tiene que nacer por seed: es el único
  // camino de arranque. Cambia esta contraseña en producción.
  const ceoPasswordHash = await bcrypt.hash("Ceo123456!", 10);
  await prisma.user.upsert({
    where: { email: "ceo@kestore.com.ec" },
    update: {},
    create: {
      email: "ceo@kestore.com.ec",
      passwordHash: ceoPasswordHash,
      name: "CEO WM",
      role: Role.CEO,
    },
  });

  // --- Categorías y subcategorías ---
  const cocina = await prisma.category.upsert({
    where: { name: "Cocina" },
    update: {},
    create: { name: "Cocina", description: "Electrodomésticos y utensilios de cocina" },
  });
  const electrodomesticos = await prisma.subcategory.upsert({
    where: { categoryId_name: { categoryId: cocina.id, name: "Electrodomésticos menores" } },
    update: {},
    create: { name: "Electrodomésticos menores", categoryId: cocina.id },
  });

  const seguridad = await prisma.category.upsert({
    where: { name: "Seguridad / Smart Home" },
    update: {},
    create: {
      name: "Seguridad / Smart Home",
      description: "Cámaras, cerraduras digitales y productos smart home",
    },
  });
  const cerraduras = await prisma.subcategory.upsert({
    where: { categoryId_name: { categoryId: seguridad.id, name: "Cerraduras digitales" } },
    update: {},
    create: { name: "Cerraduras digitales", categoryId: seguridad.id },
  });

  const mascotas = await prisma.category.upsert({
    where: { name: "Mascotas" },
    update: {},
    create: { name: "Mascotas", description: "Camas, juguetes, comederos y transportadoras" },
  });
  const camasTransportadoras = await prisma.subcategory.upsert({
    where: { categoryId_name: { categoryId: mascotas.id, name: "Camas y transportadoras" } },
    update: {},
    create: { name: "Camas y transportadoras", categoryId: mascotas.id },
  });

  // --- Proveedor y cliente de ejemplo ---
  // Supplier.name ya no es @unique en el schema (es un índice único parcial,
  // WHERE "deletedAt" IS NULL, agregado a mano en la migración) — upsert por
  // `where: { name }` ya no compila, mismo patrón findFirst+create que
  // finalCustomer más abajo.
  const proveedorExistente = await prisma.supplier.findFirst({
    where: { name: "Proveedor Demo Shenzhen", deletedAt: null },
  });
  const proveedor =
    proveedorExistente ??
    (await prisma.supplier.create({
      data: { name: "Proveedor Demo Shenzhen", contactInfo: "WeChat: demo_supplier" },
    }));

  const clienteExistente = await prisma.finalCustomer.findFirst({
    where: { fullName: "Cliente Demo Quito" },
  });
  const cliente =
    clienteExistente ??
    (await prisma.finalCustomer.create({
      data: { fullName: "Cliente Demo Quito", phone: "0999999999", address: "Quito, Ecuador" },
    }));

  // Mayorista de ejemplo, para poder probar el flujo de crédito y la
  // validación de RUC sin tener que crear uno a mano primero.
  await prisma.wholesaler.upsert({
    where: { ruc: "1791251237001" },
    update: {},
    create: {
      businessName: "Distribuidora Demo S.A.",
      ruc: "1791251237001",
      contactName: "Juan Pérez",
      phone: "022345678",
      address: "Guayaquil, Ecuador",
      creditLimit: 2000.0,
      defaultCreditDays: 30,
    },
  });

  // --- Producto 1: Freidora de aire (Cocina > Electrodomésticos menores) ---
  const freidora = await prisma.product.upsert({
    where: { sku: "WM-0001" },
    update: {},
    create: {
      sku: "WM-0001",
      name: "Freidora de aire WM",
      description: "Freidora de aire sin aceite, panel digital.",
      model: "AF-5000",
      categoryId: cocina.id,
      subcategoryId: electrodomesticos.id,
      status: ProductStatus.ACTIVE,
    },
  });
  const freidora4LPrecios = {
    // El costo USD requiere un valor confirmado; no reutilizar las referencias CNY.
    wholesalePrice: 45.0,
    wholesaleDiscountPct: 5.0,
    retailPrice: 65.0,
    retailDiscountPct: 10.0,
  };
  const freidora4L = await prisma.productVariant.upsert({
    where: { sku: "WM-0001-4L" },
    update: freidora4LPrecios,
    create: {
      productId: freidora.id,
      sku: "WM-0001-4L",
      attributes: { capacidad: "4L" },
      label: "4L",
      warehouseLocation: "Pasillo A - Estante 1 - Nivel 1",
      minStock: 5,
      ...freidora4LPrecios,
    },
  });
  const freidora6LPrecios = {
    // El costo USD requiere un valor confirmado; no reutilizar las referencias CNY.
    wholesalePrice: 55.0,
    wholesaleDiscountPct: 5.0,
    retailPrice: 79.0,
    retailDiscountPct: 10.0,
  };
  const freidora6L = await prisma.productVariant.upsert({
    where: { sku: "WM-0001-6L" },
    update: freidora6LPrecios,
    create: {
      productId: freidora.id,
      sku: "WM-0001-6L",
      attributes: { capacidad: "6L" },
      label: "6L",
      warehouseLocation: "Pasillo A - Estante 1 - Nivel 2",
      minStock: 5,
      ...freidora6LPrecios,
    },
  });

  // --- Producto 2: Chapa digital (Seguridad / Smart Home > Cerraduras digitales) ---
  const chapa = await prisma.product.upsert({
    where: { sku: "WM-0002" },
    update: {},
    create: {
      sku: "WM-0002",
      name: "Chapa digital WM",
      description: "Cerradura digital con huella, tarjeta y clave.",
      model: "DL-200",
      categoryId: seguridad.id,
      subcategoryId: cerraduras.id,
      status: ProductStatus.ACTIVE,
    },
  });
  const chapaNegraHuellaPrecios = {
    // El costo USD requiere un valor confirmado; no reutilizar las referencias CNY.
    wholesalePrice: 95.0,
    wholesaleDiscountPct: 8.0,
    retailPrice: 139.0,
    retailDiscountPct: 12.0,
  };
  const chapaNegraHuella = await prisma.productVariant.upsert({
    where: { sku: "WM-0002-NEGRO-HUELLA" },
    update: chapaNegraHuellaPrecios,
    create: {
      productId: chapa.id,
      sku: "WM-0002-NEGRO-HUELLA",
      attributes: { color: "Negro", apertura: "Huella" },
      label: "Negro / Huella",
      warehouseLocation: "Pasillo B - Estante 2 - Nivel 1",
      minStock: 3,
      ...chapaNegraHuellaPrecios,
    },
  });
  const chapaDoradaTarjetaPrecios = {
    // El costo USD requiere un valor confirmado; no reutilizar las referencias CNY.
    wholesalePrice: 89.0,
    wholesaleDiscountPct: 8.0,
    retailPrice: 129.0,
    retailDiscountPct: 12.0,
  };
  const chapaDoradaTarjeta = await prisma.productVariant.upsert({
    where: { sku: "WM-0002-DORADO-TARJETA" },
    update: chapaDoradaTarjetaPrecios,
    create: {
      productId: chapa.id,
      sku: "WM-0002-DORADO-TARJETA",
      attributes: { color: "Dorado", apertura: "Tarjeta" },
      label: "Dorado / Tarjeta",
      warehouseLocation: "Pasillo B - Estante 2 - Nivel 2",
      minStock: 3,
      ...chapaDoradaTarjetaPrecios,
    },
  });

  // --- Producto 3: Cama para mascota (Mascotas > Camas y transportadoras) ---
  const cama = await prisma.product.upsert({
    where: { sku: "WM-0003" },
    update: {},
    create: {
      sku: "WM-0003",
      name: "Cama para mascota WM",
      description: "Cama acolchada lavable para perros y gatos.",
      model: "PB-100",
      categoryId: mascotas.id,
      subcategoryId: camasTransportadoras.id,
      status: ProductStatus.ACTIVE,
    },
  });
  const camaSPrecios = {
    // El costo USD requiere un valor confirmado; no reutilizar las referencias CNY.
    wholesalePrice: 12.0,
    wholesaleDiscountPct: 5.0,
    retailPrice: 18.0,
    retailDiscountPct: 10.0,
  };
  const camaS = await prisma.productVariant.upsert({
    where: { sku: "WM-0003-S" },
    update: camaSPrecios,
    create: {
      productId: cama.id,
      sku: "WM-0003-S",
      attributes: { tamaño: "S" },
      label: "Talla S",
      warehouseLocation: "Pasillo C - Estante 1 - Nivel 1",
      minStock: 8,
      ...camaSPrecios,
    },
  });
  const camaMPrecios = {
    // El costo USD requiere un valor confirmado; no reutilizar las referencias CNY.
    wholesalePrice: 15.0,
    wholesaleDiscountPct: 5.0,
    retailPrice: 22.0,
    retailDiscountPct: 10.0,
  };
  const camaM = await prisma.productVariant.upsert({
    where: { sku: "WM-0003-M" },
    update: camaMPrecios,
    create: {
      productId: cama.id,
      sku: "WM-0003-M",
      attributes: { tamaño: "M" },
      label: "Talla M",
      warehouseLocation: "Pasillo C - Estante 1 - Nivel 2",
      minStock: 8,
      ...camaMPrecios,
    },
  });
  const camaLPrecios = {
    // El costo USD requiere un valor confirmado; no reutilizar las referencias CNY.
    wholesalePrice: 19.0,
    wholesaleDiscountPct: 5.0,
    retailPrice: 27.0,
    retailDiscountPct: 10.0,
  };
  const camaL = await prisma.productVariant.upsert({
    where: { sku: "WM-0003-L" },
    update: camaLPrecios,
    create: {
      productId: cama.id,
      sku: "WM-0003-L",
      attributes: { tamaño: "L" },
      label: "Talla L",
      warehouseLocation: "Pasillo C - Estante 1 - Nivel 3",
      minStock: 5,
      ...camaLPrecios,
    },
  });

  // --- Lote de importación de ejemplo + movimientos de ingreso ---
  // Así el stock inicial nace de movimientos reales (ledger), tal como lo
  // hará la API real, y no de un valor puesto a mano en la variante.
  const referenciaLote = "CONT-DEMO-0001";
  const loteExistente = await prisma.importBatch.findUnique({
    where: { reference: referenciaLote },
  });

  if (!loteExistente) {
    const lote = await prisma.importBatch.create({
      data: {
        reference: referenciaLote,
        supplierId: proveedor.id,
        arrivalDate: new Date(),
        notes: "Lote de ejemplo generado por el seed inicial.",
      },
    });

    // unitCost = costo real (en USD, ya nacionalizado) de esa entrada específica.
    // Es lo que se usa para el costo promedio ponderado en reportes de rentabilidad;
    // es distinto de costPriceUSD (que es solo un precio de referencia de fábrica).
    const ingresosIniciales = [
      { variant: freidora4L, cantidad: 20, unitCost: 22.5 },
      { variant: freidora6L, cantidad: 15, unitCost: 27.0 },
      { variant: chapaNegraHuella, cantidad: 10, unitCost: 38.0 },
      { variant: chapaDoradaTarjeta, cantidad: 8, unitCost: 35.0 },
      { variant: camaS, cantidad: 25, unitCost: 6.5 },
      { variant: camaM, cantidad: 20, unitCost: 8.0 },
      { variant: camaL, cantidad: 12, unitCost: 10.0 },
    ];

    for (const { variant, cantidad, unitCost } of ingresosIniciales) {
      // Movimiento + actualización del stock cacheado en la misma transacción:
      // este es el patrón que usará también la API para todo ingreso/salida/ajuste.
      await prisma.$transaction([
        prisma.inventoryMovement.create({
          data: {
            variantId: variant.id,
            type: MovementType.INGRESO,
            quantity: cantidad,
            stockAfter: cantidad, // parte de 0 stock
            unitCost,
            importBatchId: lote.id,
            notes: "Ingreso inicial de ejemplo (seed).",
          },
        }),
        prisma.productVariant.update({
          where: { id: variant.id },
          data: { stock: { increment: cantidad } },
        }),
      ]);
    }
  }

  // --- Orden de despacho de ejemplo (demuestra el cálculo de costo promedio) ---
  // Se calcula unitCostSnapshot como el promedio ponderado de los
  // InventoryMovement de tipo INGRESO de cada variante hasta este momento
  // (aquí solo hay uno por variante, así que el promedio es igual a ese
  // unitCost). La API real hará este mismo cálculo al confirmar cualquier
  // orden de despacho.
  const numeroOrdenDemo = "OD-000001";
  const ordenExistente = await prisma.dispatchOrder.findUnique({
    where: { orderNumber: numeroOrdenDemo },
  });

  if (!ordenExistente) {
    async function costoPromedioPonderado(variantId: string): Promise<number> {
      const ingresos = await prisma.inventoryMovement.findMany({
        where: { variantId, type: MovementType.INGRESO, unitCost: { not: null } },
      });
      const totalUnidades = ingresos.reduce((sum, m) => sum + m.quantity, 0);
      const totalCosto = ingresos.reduce(
        (sum, m) => sum + Number(m.unitCost) * m.quantity,
        0
      );
      return totalUnidades > 0 ? totalCosto / totalUnidades : 0;
    }

    const itemsOrden = [
      {
        variant: freidora4L,
        cantidad: 3,
        priceType: PriceType.PVP,
        precioLista: 65.0,
        descuentoPct: 10.0,
      },
      {
        variant: chapaNegraHuella,
        cantidad: 2,
        priceType: PriceType.MAYORISTA,
        precioLista: 95.0,
        descuentoPct: 8.0,
      },
    ];

    const orden = await prisma.dispatchOrder.create({
      data: {
        orderNumber: numeroOrdenDemo,
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: cliente.id,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTADO",
        status: "DESPACHADO",
        dispatchDate: new Date(),
        notes: "Orden de ejemplo generada por el seed inicial.",
      },
    });

    for (const { variant, cantidad, priceType, precioLista, descuentoPct } of itemsOrden) {
      const unitCostSnapshot = await costoPromedioPonderado(variant.id);
      const unitPrice = precioLista * (1 - descuentoPct / 100);

      // Transacción interactiva: el ítem, el movimiento de SALIDA y el
      // descuento del stock cacheado se confirman todos juntos o ninguno.
      // Es el mismo patrón que usará la API al confirmar una orden real.
      await prisma.$transaction(async (tx) => {
        const item = await tx.dispatchOrderItem.create({
          data: {
            dispatchOrderId: orden.id,
            variantId: variant.id,
            quantity: cantidad,
            priceType,
            unitPrice,
            discountPct: descuentoPct,
            unitCostSnapshot,
          },
        });

        const variantActualizada = await tx.productVariant.update({
          where: { id: variant.id },
          data: { stock: { decrement: cantidad } },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: variant.id,
            type: MovementType.SALIDA,
            quantity: -cantidad,
            stockAfter: variantActualizada.stock,
            dispatchOrderItemId: item.id,
            notes: "Salida de ejemplo generada por el seed inicial.",
          },
        });
      });
    }
  }

  console.log("Seed completado: categorías, productos, variantes, stock y orden de ejemplo creados.");
}

main()
  .catch((error) => {
    console.error("Error al ejecutar el seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
