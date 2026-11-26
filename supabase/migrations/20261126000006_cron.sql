-- =====================================================================
-- Eventos360 · Etapa 1 · Tareas programadas
-- =====================================================================
create extension if not exists pg_cron;

select cron.schedule(
  'eventos360-refresh-subscriptions',
  '7 * * * *',                       -- cada hora, minuto 7
  $$select private.refresh_subscription_statuses()$$
);
