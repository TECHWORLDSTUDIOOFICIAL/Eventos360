# Eventos360

Plataforma SaaS para la industria de eventos con tres modalidades independientes:

- **Personal**: particulares que organizan su propia celebración.
- **Profesional**: organizadores independientes con múltiples clientes.
- **Business**: empresas, con experiencia según su especialidad (decoración, alquiler, locales, catering, etc.).

## Arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind (SPA estática) → **GitHub Pages** |
| Backend | **Supabase**: Postgres con RLS, funciones RPC, Edge Functions, pg_cron |
| Dominio | DonWeb (DNS apuntando a GitHub Pages) |

- **Multi-tenant**: todo dato de negocio pertenece a un `workspace`. RLS + funciones `private.*` garantizan aislamiento.
- **Modalidad inmutable** por workspace; sin vínculos entre modalidades.
- **Módulos dinámicos**: `modules` + `specialties` + `specialty_modules` + entitlements del plan → `workspace_modules_for()`.
- **Registro solo con código de acceso** (pago manual por fuera). Sin correo electrónico: usuario + contraseña.
- **Panel administrativo** en `/admin` (solo `platform_admins`).

## Estructura

```
supabase/migrations/   Esquema, RLS, RPC y catálogo (aplicados en el proyecto)
supabase/functions/    Edge Functions: signup, admin-users
supabase/tests/        Pruebas SQL de seguridad (aislamiento, códigos, vencimientos)
src/                   Aplicación web
```

## Desarrollo

```bash
npm install
npm run dev
npm test
```

`.env` solo contiene valores públicos (URL y clave publicable). La service role key **nunca** va en el frontend;
las Edge Functions la reciben de Supabase automáticamente.

## Despliegue

Cada push a `main` publica en GitHub Pages (`.github/workflows/deploy.yml`).
Para usar dominio propio: crea la variable de repositorio `CUSTOM_DOMAIN` (p. ej. `www.tudominio.com`)
y configura en DonWeb un registro CNAME hacia `techworldstudiooficial.github.io`.
