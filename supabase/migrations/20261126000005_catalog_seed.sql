-- =====================================================================
-- Eventos360 · Etapa 1 · Catálogo inicial (configuración, no datos de clientes)
-- Precios y límites son hipótesis editables desde el panel administrativo.
-- =====================================================================

insert into public.currencies(code, name, symbol, decimals) values
  ('NIO', 'Córdoba nicaragüense', 'C$', 2),
  ('USD', 'Dólar estadounidense', 'US$', 2);

insert into public.countries(code, name, default_currency, default_timezone, default_locale, default_tax_rate, tax_label) values
  ('NI', 'Nicaragua', 'NIO', 'America/Managua', 'es-NI', 15, 'IVA');

insert into public.platform_settings(key, value, description) values
  ('billing.grace_days', '5', 'Días de gracia tras el vencimiento antes de suspender (solo lectura)'),
  ('support.whatsapp', '""', 'Número de WhatsApp de ventas/soporte mostrado a los clientes (formato internacional, ej. 50588888888)'),
  ('support.message', '"Para adquirir o renovar tu plan, contáctanos. Al confirmar tu pago te enviaremos tu código de acceso."', 'Mensaje mostrado en registro y renovación');

-- ---------------------------------------------------------------------
-- Funcionalidades / límites
-- ---------------------------------------------------------------------
insert into public.features(key, name, value_type, sort, description) values
  ('events.max',           'Eventos activos',               'limit',   10, 'Cantidad máxima de eventos'),
  ('guests.max',           'Invitados por evento',          'limit',   20, null),
  ('customers.max',        'Clientes',                      'limit',   30, null),
  ('members.max',          'Usuarios del equipo',           'limit',   40, 'Incluye al propietario'),
  ('catalog_items.max',    'Productos y servicios',         'limit',   50, null),
  ('resources.max',        'Artículos de inventario',       'limit',   60, null),
  ('venues.max',           'Espacios / locales',            'limit',   70, null),
  ('specialties.max',      'Especialidades del negocio',    'limit',   80, null),
  ('storage.mb',           'Almacenamiento (MB)',           'limit',   90, null),
  ('invitations.digital',  'Invitaciones digitales',        'boolean', 100, null),
  ('exports.excel',        'Exportación a Excel',           'boolean', 110, null),
  ('exports.pdf',          'Documentos PDF',                'boolean', 120, 'Cotizaciones, contratos y reportes en PDF'),
  ('reports.advanced',     'Reportes avanzados',            'boolean', 130, null),
  ('automations',          'Recordatorios automáticos',     'boolean', 140, null);

-- ---------------------------------------------------------------------
-- Módulos
-- kinds = dónde puede existir · default_kinds = activo sin depender de especialidad
-- ---------------------------------------------------------------------
insert into public.modules(key, name, kinds, default_kinds, required_feature, sort) values
  -- Personal
  ('home',          'Inicio',            '{personal}', '{personal}', null, 10),
  ('my_event',      'Mi evento',         '{personal}', '{personal}', null, 20),
  ('guests',        'Invitados',         '{personal,professional,business}', '{personal}', null, 30),
  ('invitations',   'Invitaciones',      '{personal,professional,business}', '{personal}', 'invitations.digital', 40),
  ('budget',        'Presupuesto',       '{personal}', '{personal}', null, 50),
  ('seating',       'Mesas',             '{personal,professional,business}', '{personal}', null, 60),
  ('schedule',      'Cronograma',        '{personal,professional,business}', '{personal,professional}', null, 65),
  ('tasks',         'Tareas',            '{personal,professional,business}', '{personal,professional}', null, 70),
  ('suppliers',     'Proveedores',       '{personal,professional,business}', '{personal,professional}', null, 80),
  ('inspiration',   'Inspiración',       '{personal}', '{personal}', null, 90),
  -- Profesional y Business (compartidos)
  ('dashboard',     'Dashboard',         '{professional,business}', '{professional,business}', null, 1),
  ('customers',     'Clientes',          '{professional,business}', '{professional}', null, 20),
  ('events',        'Eventos',           '{professional,business}', '{professional}', null, 25),
  ('quotes',        'Cotizaciones',      '{professional,business}', '{professional}', null, 30),
  ('contracts',     'Contratos',         '{professional,business}', '{professional}', null, 35),
  ('calendar',      'Calendario',        '{professional,business}', '{professional}', null, 40),
  ('finance',       'Finanzas',          '{professional,business}', '{professional}', null, 90),
  ('reports',       'Reportes',          '{professional,business}', '{professional,business}', null, 95),
  ('team',          'Equipo',            '{business}', '{business}', null, 97),
  -- Business especializados
  ('catalog',       'Catálogo',          '{business}', '{}', null, 100),
  ('packages',      'Paquetes',          '{business}', '{}', null, 105),
  ('inventory',     'Inventario',        '{business}', '{}', null, 110),
  ('reservations',  'Reservaciones',     '{business}', '{}', null, 115),
  ('availability',  'Disponibilidad',    '{business}', '{}', null, 120),
  ('deliveries',    'Entregas',          '{business}', '{}', null, 125),
  ('returns',       'Devoluciones',      '{business}', '{}', null, 130),
  ('maintenance',   'Mantenimiento',     '{business}', '{}', null, 135),
  ('installations', 'Montajes',          '{business}', '{}', null, 140),
  ('venues',        'Espacios',          '{business}', '{}', null, 145),
  ('venue_rates',   'Tarifas',           '{business}', '{}', null, 150),
  ('menus',         'Menús',             '{business}', '{}', null, 155),
  ('orders',        'Pedidos',           '{business}', '{}', null, 160),
  ('ingredients',   'Ingredientes',      '{business}', '{}', null, 165),
  ('workforce',     'Personal',          '{business}', '{}', null, 170),
  ('shifts',        'Asignaciones',      '{business}', '{}', null, 175),
  ('sessions',      'Sesiones',          '{business}', '{}', null, 180),
  ('deliverables',  'Entregables',       '{business}', '{}', null, 185),
  ('portfolio',     'Galería',           '{business}', '{}', null, 190);

-- ---------------------------------------------------------------------
-- Especialidades Business
-- ---------------------------------------------------------------------
insert into public.specialties(key, name, icon, sort, description) values
  ('decoration',     'Decoración de eventos',              'sparkles',  10, 'Bodas, quinceaños, cumpleaños, corporativos, temáticos y montajes'),
  ('rental',         'Alquiler de mobiliario y equipo',    'armchair',  20, 'Sillas, mesas, mantelería, carpas, vajilla, tarimas y estructuras'),
  ('venue',          'Alquiler de locales y espacios',     'building',  30, 'Salones, jardines, fincas, terrazas y centros de convenciones'),
  ('catering',       'Catering y alimentación',            'utensils',  40, 'Banquetes, buffet, repostería, pastelería y bebidas'),
  ('photo_video',    'Fotografía y video',                 'camera',    50, 'Fotógrafos y productoras audiovisuales'),
  ('sound_lighting', 'Sonido, iluminación y entretenimiento', 'speaker', 60, 'Sonido, luces, DJ, pantallas LED, escenarios y animación'),
  ('florist',        'Floristería',                        'flower',    70, 'Arreglos florales y producción'),
  ('attire',         'Alquiler de vestidos y trajes',      'shirt',     80, 'Vestidos de quinceaños, novia, fiesta, trajes y accesorios'),
  ('staffing',       'Personal y servicios para eventos',  'users',     90, 'Meseros, bartenders, protocolo, seguridad, limpieza, montaje'),
  ('full_service',   'Organización integral de eventos',   'calendar',  100, 'Empresas que coordinan el evento completo');

insert into public.specialty_modules(specialty_key, module_key, sort, label_override) values
  -- Decoración
  ('decoration','catalog',10,'Decoraciones'), ('decoration','packages',20,null), ('decoration','inventory',30,'Materiales'),
  ('decoration','customers',40,null), ('decoration','quotes',50,null), ('decoration','reservations',60,null),
  ('decoration','events',70,null), ('decoration','installations',80,null), ('decoration','calendar',90,null),
  ('decoration','workforce',100,'Personal de montaje'), ('decoration','suppliers',110,null),
  ('decoration','portfolio',120,'Galería de trabajos'), ('decoration','finance',130,null),
  -- Alquiler de mobiliario
  ('rental','inventory',10,null), ('rental','reservations',20,null), ('rental','availability',30,null),
  ('rental','customers',40,null), ('rental','quotes',50,null), ('rental','contracts',60,null),
  ('rental','deliveries',70,null), ('rental','returns',80,null), ('rental','maintenance',90,'Daños y mantenimiento'),
  ('rental','finance',100,null),
  -- Locales
  ('venue','venues',10,null), ('venue','availability',20,null), ('venue','reservations',30,null),
  ('venue','venue_rates',40,null), ('venue','customers',50,null), ('venue','quotes',60,null),
  ('venue','contracts',70,null), ('venue','calendar',80,null), ('venue','maintenance',90,null),
  ('venue','finance',100,null),
  -- Catering
  ('catering','menus',10,null), ('catering','packages',20,null), ('catering','orders',30,null),
  ('catering','customers',40,null), ('catering','quotes',50,null), ('catering','ingredients',60,null),
  ('catering','calendar',70,null), ('catering','workforce',80,'Personal de servicio'), ('catering','deliveries',90,null),
  ('catering','finance',100,null),
  -- Fotografía y video
  ('photo_video','customers',10,null), ('photo_video','events',20,null), ('photo_video','packages',30,null),
  ('photo_video','sessions',40,null), ('photo_video','quotes',50,null), ('photo_video','contracts',60,null),
  ('photo_video','inventory',70,'Equipamiento'), ('photo_video','workforce',80,'Fotógrafos y videógrafos'),
  ('photo_video','deliverables',90,null), ('photo_video','calendar',100,null), ('photo_video','finance',110,null),
  -- Sonido e iluminación
  ('sound_lighting','catalog',10,'Equipos'), ('sound_lighting','inventory',20,null), ('sound_lighting','packages',30,null),
  ('sound_lighting','reservations',40,null), ('sound_lighting','availability',50,null), ('sound_lighting','customers',60,null),
  ('sound_lighting','quotes',70,null), ('sound_lighting','contracts',80,null), ('sound_lighting','workforce',90,'Técnicos'),
  ('sound_lighting','installations',100,'Instalación y desmontaje'), ('sound_lighting','maintenance',110,null),
  ('sound_lighting','finance',120,null),
  -- Floristería
  ('florist','catalog',10,'Arreglos'), ('florist','inventory',20,'Flores e insumos'), ('florist','orders',30,'Pedidos y producción'),
  ('florist','customers',40,null), ('florist','quotes',50,null), ('florist','deliveries',60,null),
  ('florist','suppliers',70,null), ('florist','calendar',80,null), ('florist','finance',90,null),
  -- Vestidos y trajes
  ('attire','catalog',10,'Prendas'), ('attire','reservations',20,null), ('attire','availability',30,null),
  ('attire','customers',40,null), ('attire','sessions',50,'Pruebas'), ('attire','deliveries',60,null),
  ('attire','returns',70,null), ('attire','maintenance',80,'Limpieza y arreglos'), ('attire','finance',90,null),
  -- Personal para eventos
  ('staffing','workforce',10,'Trabajadores'), ('staffing','catalog',20,'Servicios y tarifas'), ('staffing','shifts',30,null),
  ('staffing','customers',40,null), ('staffing','quotes',50,null), ('staffing','events',60,null),
  ('staffing','calendar',70,null), ('staffing','finance',80,null),
  -- Organización integral
  ('full_service','customers',10,null), ('full_service','events',20,null), ('full_service','quotes',30,null),
  ('full_service','contracts',40,null), ('full_service','calendar',50,null), ('full_service','schedule',60,null),
  ('full_service','tasks',70,null), ('full_service','suppliers',80,null), ('full_service','catalog',90,'Servicios'),
  ('full_service','inventory',100,null), ('full_service','workforce',110,null), ('full_service','guests',120,null),
  ('full_service','seating',130,null), ('full_service','finance',140,null);

-- ---------------------------------------------------------------------
-- Planes (precios en USD; hipótesis iniciales)
-- ---------------------------------------------------------------------
insert into public.plans(key, kind, name, description, price, currency_code, duration_days, sort) values
  ('personal_mensual', 'personal',     'Personal Mensual',     'Organiza tu evento paso a paso',              5.99, 'USD', 30, 10),
  ('personal_anual',   'personal',     'Personal Anual',       'Doce meses para organizar tus celebraciones', 59.00, 'USD', 365, 20),
  ('pro_mensual',      'professional', 'Profesional Mensual',  'Para organizadores independientes',           14.99, 'USD', 30, 10),
  ('pro_anual',        'professional', 'Profesional Anual',    'Ahorra con el pago anual',                    149.00, 'USD', 365, 20),
  ('biz_inicial',      'business',     'Business Inicial',     'Para negocios que comienzan',                 19.99, 'USD', 30, 10),
  ('biz_profesional',  'business',     'Business Profesional', 'Más capacidad y equipo',                      34.99, 'USD', 30, 20),
  ('biz_empresarial',  'business',     'Business Empresarial', 'Operación completa y multi-especialidad',     59.99, 'USD', 30, 30);

-- Límites: (plan, feature, habilitado, límite) ; límite NULL = ilimitado
insert into public.plan_entitlements(plan_id, feature_key, is_enabled, limit_value)
select p.id, v.feature_key, v.is_enabled, v.limit_value
from (values
  ('personal_mensual','events.max',true,1), ('personal_mensual','guests.max',true,300), ('personal_mensual','members.max',true,2),
  ('personal_mensual','storage.mb',true,200), ('personal_mensual','invitations.digital',true,null), ('personal_mensual','exports.excel',true,null),
  ('personal_mensual','exports.pdf',true,null),
  ('personal_anual','events.max',true,3), ('personal_anual','guests.max',true,600), ('personal_anual','members.max',true,3),
  ('personal_anual','storage.mb',true,500), ('personal_anual','invitations.digital',true,null), ('personal_anual','exports.excel',true,null),
  ('personal_anual','exports.pdf',true,null),

  ('pro_mensual','events.max',true,null), ('pro_mensual','guests.max',true,600), ('pro_mensual','customers.max',true,150),
  ('pro_mensual','members.max',true,1), ('pro_mensual','catalog_items.max',true,100), ('pro_mensual','storage.mb',true,1000),
  ('pro_mensual','invitations.digital',true,null), ('pro_mensual','exports.excel',true,null), ('pro_mensual','exports.pdf',true,null),
  ('pro_anual','events.max',true,null), ('pro_anual','guests.max',true,1000), ('pro_anual','customers.max',true,400),
  ('pro_anual','members.max',true,2), ('pro_anual','catalog_items.max',true,300), ('pro_anual','storage.mb',true,3000),
  ('pro_anual','invitations.digital',true,null), ('pro_anual','exports.excel',true,null), ('pro_anual','exports.pdf',true,null),
  ('pro_anual','reports.advanced',true,null),

  ('biz_inicial','specialties.max',true,1), ('biz_inicial','members.max',true,2), ('biz_inicial','customers.max',true,200),
  ('biz_inicial','catalog_items.max',true,150), ('biz_inicial','resources.max',true,150), ('biz_inicial','venues.max',true,2),
  ('biz_inicial','events.max',true,null), ('biz_inicial','guests.max',true,600), ('biz_inicial','storage.mb',true,1000),
  ('biz_inicial','exports.excel',true,null), ('biz_inicial','exports.pdf',true,null), ('biz_inicial','invitations.digital',true,null),
  ('biz_profesional','specialties.max',true,2), ('biz_profesional','members.max',true,6), ('biz_profesional','customers.max',true,1000),
  ('biz_profesional','catalog_items.max',true,800), ('biz_profesional','resources.max',true,800), ('biz_profesional','venues.max',true,5),
  ('biz_profesional','events.max',true,null), ('biz_profesional','guests.max',true,1000), ('biz_profesional','storage.mb',true,4000),
  ('biz_profesional','exports.excel',true,null), ('biz_profesional','exports.pdf',true,null), ('biz_profesional','invitations.digital',true,null),
  ('biz_profesional','reports.advanced',true,null),
  ('biz_empresarial','specialties.max',true,4), ('biz_empresarial','members.max',true,15), ('biz_empresarial','customers.max',true,null),
  ('biz_empresarial','catalog_items.max',true,null), ('biz_empresarial','resources.max',true,null), ('biz_empresarial','venues.max',true,15),
  ('biz_empresarial','events.max',true,null), ('biz_empresarial','guests.max',true,2000), ('biz_empresarial','storage.mb',true,10000),
  ('biz_empresarial','exports.excel',true,null), ('biz_empresarial','exports.pdf',true,null), ('biz_empresarial','invitations.digital',true,null),
  ('biz_empresarial','reports.advanced',true,null), ('biz_empresarial','automations',true,null)
) as v(plan_key, feature_key, is_enabled, limit_value)
join public.plans p on p.key = v.plan_key;
