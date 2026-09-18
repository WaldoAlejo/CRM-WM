// Cliente mínimo contra la API de Neon (branches). Solo se usa cuando
// NEON_EPHEMERAL_TEST_BRANCH=true (pensado para CI); en el día a día
// (`npm test` local) esto no se toca para nada — se sigue usando la branch
// fija de .env.test, sin llamadas a ninguna API externa ni riesgo de dejar
// recursos huérfanos si algo falla a mitad de una corrida local.
const NEON_API_BASE = "https://console.neon.tech/api/v2";

// Toda branch efímera se crea con este prefijo en el nombre, y
// deleteEphemeralBranch() se NIEGA a borrar cualquier cosa que no lo tenga.
// Es la protección para que, aunque este código se invocara con un id
// equivocado por error, sea imposible que termine borrando una branch que
// no haya creado él mismo en esta misma corrida.
const BRANCH_NAME_PREFIX = "ci-test-";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name} (necesaria para la branch efímera de Neon).`);
  }
  return value;
}

interface NeonBranchDetail {
  id: string;
  name: string;
  default: boolean;
  parent_id?: string;
}

interface NeonCreateBranchResponse {
  branch: NeonBranchDetail;
  endpoints: Array<{ host: string; type: string }>;
}

async function neonFetch(path: string, init: RequestInit): Promise<Response> {
  const apiKey = requireEnv("NEON_API_KEY");
  return fetch(`${NEON_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
}

// Verificación de seguridad #1 (ANTES de crear nada): confirma contra la API
// que TEST_FIXED_BRANCH_ID no es, hoy, la branch por defecto del proyecto
// ("production" en este caso). Esto es lo que evita que una branch efímera
// termine copiando datos reales si TEST_FIXED_BRANCH_ID llegara a faltar del
// entorno, a estar mal escrito, o si alguien reconfigura cuál es la branch
// por defecto del proyecto más adelante.
async function assertNotDefaultBranch(projectId: string, branchId: string): Promise<NeonBranchDetail> {
  const res = await neonFetch(`/projects/${projectId}/branches/${branchId}`, { method: "GET" });
  if (!res.ok) {
    throw new Error(
      `No se pudo verificar la branch padre (${branchId}) antes de crear la efímera ` +
        `(HTTP ${res.status}): ${await res.text()}`
    );
  }
  const data = (await res.json()) as { branch: NeonBranchDetail };
  if (data.branch.default) {
    throw new Error(
      `Abortado por seguridad: TEST_FIXED_BRANCH_ID ("${branchId}") apunta a "${data.branch.name}", ` +
        `que es la branch por DEFECTO del proyecto (probablemente production). Nunca se crea una branch ` +
        `efímera a partir de la branch por defecto — revisa la variable TEST_FIXED_BRANCH_ID.`
    );
  }
  return data.branch;
}

export interface EphemeralBranch {
  branchId: string;
  branchName: string;
  // Misma URL para ambas: ver nota en createEphemeralBranch sobre por qué
  // esta branch de corta vida no pasa por el connection pooler.
  databaseUrl: string;
  directUrl: string;
}

export async function createEphemeralBranch(): Promise<EphemeralBranch> {
  const projectId = requireEnv("NEON_PROJECT_ID");
  const parentBranchId = requireEnv("TEST_FIXED_BRANCH_ID");

  // Verificación #1: la branch padre configurada no puede ser la default.
  await assertNotDefaultBranch(projectId, parentBranchId);

  const name = `${BRANCH_NAME_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const res = await neonFetch(`/projects/${projectId}/branches`, {
    method: "POST",
    // parent_id explícito: NUNCA se confía en que Neon elija un padre por
    // default (que sería justamente la branch por defecto del proyecto).
    body: JSON.stringify({
      branch: { name, parent_id: parentBranchId },
      endpoints: [{ type: "read_write" }],
    }),
  });
  if (!res.ok) {
    throw new Error(`No se pudo crear la branch efímera de Neon (HTTP ${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as NeonCreateBranchResponse;

  // Verificación #2 (DESPUÉS de crear): confirma en la respuesta real de la
  // API que el parent_id que quedó registrado es efectivamente el que se
  // pidió. Defensa en profundidad por si la API alguna vez ignorara o
  // reinterpretara el parent_id enviado.
  if (data.branch.parent_id !== parentBranchId) {
    throw new Error(
      `Abortado por seguridad: la branch efímera se creó con parent_id="${data.branch.parent_id}", ` +
        `distinto del TEST_FIXED_BRANCH_ID solicitado ("${parentBranchId}"). Revisa manualmente la branch ` +
        `"${data.branch.name}" (${data.branch.id}) en el panel de Neon.`
    );
  }

  const endpoint = data.endpoints.find((e) => e.type === "read_write");
  if (!endpoint) throw new Error("La branch de Neon se creó pero sin endpoint read_write.");

  // Las branches de Neon heredan usuario/password de la branch padre (son
  // parte de la copia-en-escritura): se reutiliza la misma credencial de
  // DATABASE_URL_TEST, solo cambia el host. Se usa el endpoint DIRECTO (sin
  // "-pooler") para las dos URLs a propósito: es una branch efímera, de
  // concurrencia baja (los tests ya corren en serie, ver vitest.config.mts),
  // así que no hace falta pooler — y evita reintroducir la clase de bug que
  // causó el incidente anterior (SQL crudo + pooler + search_path ambiguo).
  const parentUrl = new URL(requireEnv("DATABASE_URL_TEST"));
  const url = new URL(parentUrl.toString());
  url.host = endpoint.host;
  url.searchParams.set("schema", "test_integration");
  const connectionUrl = url.toString();

  return {
    branchId: data.branch.id,
    branchName: data.branch.name,
    databaseUrl: connectionUrl,
    directUrl: connectionUrl,
  };
}

// Reintenta una conexión trivial hasta que el cómputo de la branch nueva
// esté listo para aceptar queries (justo después de crearla puede tardar un
// instante en propagar el routing/DNS del endpoint).
export async function waitUntilReady(directUrl: string, attempts = 10): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  for (let i = 1; i <= attempts; i++) {
    const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
    try {
      await prisma.$queryRawUnsafe("SELECT 1;");
      await prisma.$disconnect();
      return;
    } catch (err) {
      await prisma.$disconnect();
      if (i === attempts) {
        throw new Error(`La branch efímera no respondió tras ${attempts} intentos: ${err}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export async function deleteEphemeralBranch(branchId: string, branchName: string): Promise<void> {
  if (!branchName.startsWith(BRANCH_NAME_PREFIX)) {
    throw new Error(
      `Rechazado por seguridad: se intentó borrar una branch ("${branchName}") sin el prefijo ` +
        `"${BRANCH_NAME_PREFIX}" con el que esta función siempre crea sus propias branches.`
    );
  }

  const projectId = requireEnv("NEON_PROJECT_ID");
  const res = await neonFetch(`/projects/${projectId}/branches/${branchId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`No se pudo borrar la branch efímera ${branchId} (HTTP ${res.status}): ${await res.text()}`);
  }
}
