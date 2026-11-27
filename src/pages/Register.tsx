import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, Check, KeyRound, MessageCircle } from "lucide-react";
import { callFunction } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { formatAccessCode, normalizeUsername, passwordError, usernameError } from "@/lib/accounts";
import { MODALITIES } from "@/lib/modalities";
import { SPECIALTY_ICONS, isModuleReady } from "@/lib/modules";
import { usePlatformSettings, useSpecialtyModules, whatsappLink } from "@/lib/queries";
import type { Specialty, WorkspaceKind } from "@/lib/types";
import { AuthLayout } from "@/components/AuthLayout";
import { Alert, Badge, Button, Field, Input, cx } from "@/components/ui";

interface CheckResult {
  ok: true;
  purpose: "signup" | "platform_admin";
  kind?: WorkspaceKind;
  plan_name?: string;
  duration_days?: number;
  preset_specialties?: string[];
  specialties_max?: number;
  specialties?: Specialty[];
}

export default function Register() {
  const { data: specMods } = useSpecialtyModules();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const { data: settings } = usePlatformSettings();
  const [step, setStep] = useState<"code" | "details">("code");
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [phone, setPhone] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [specs, setSpecs] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  const wa = whatsappLink(settings, "Hola, quiero adquirir un plan de Eventos360.");

  async function checkCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await callFunction<CheckResult>("signup", { action: "check", code });
      setInfo(res);
      setSpecs(res.preset_specialties ?? []);
      setStep("details");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = info?.purpose === "platform_admin";
  const kind = info?.kind;
  const presetLocked = (info?.preset_specialties?.length ?? 0) > 0;
  const maxSpecs = info?.specialties_max ?? 1;

  const errors = {
    fullName: fullName.trim().length < 2 ? "Ingresa tu nombre completo." : null,
    username: usernameError(username),
    password: passwordError(password),
    password2: password2 !== password ? "Las contraseñas no coinciden." : null,
    workspaceName: !isAdmin && kind !== "personal" && workspaceName.trim().length < 2 ? "Ingresa el nombre." : null,
    specs: kind === "business" && specs.length === 0 ? "Selecciona al menos la especialidad principal." : null,
  };
  const valid = Object.values(errors).every((v) => !v);

  function toggleSpec(key: string) {
    if (presetLocked) return;
    setSpecs((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      if (cur.length >= maxSpecs) return maxSpecs === 1 ? [key] : cur;
      return [...cur, key];
    });
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setError(null);
    setBusy(true);
    try {
      await callFunction("signup", {
        action: "register",
        code,
        username: normalizeUsername(username),
        password,
        fullName,
        phone,
        workspaceName,
        specialties: specs,
      });
      await signIn(username, password);
      navigate(isAdmin ? "/admin" : "/espacios", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <AuthLayout
        title="Crea tu cuenta"
        subtitle="El registro en Eventos360 se realiza con un código de acceso que recibes al adquirir tu plan."
        footer={<>¿Ya tienes cuenta? <Link to="/acceso" className="font-semibold text-brand underline-offset-4 hover:underline">Inicia sesión</Link></>}
      >
        <form onSubmit={checkCode} className="space-y-5">
          <Field label="Código de acceso" hint="Formato: E360-XXXX-XXXX-XXXX-XXXX">
            {(id, d) => (
              <Input id={id} aria-describedby={d} value={code} onChange={(e) => setCode(formatAccessCode(e.target.value))}
                placeholder="E360-____-____-____-____" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                className="font-mono tracking-wider" />
            )}
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.replace(/[^A-Z0-9]/g, "").length < 20} icon={<KeyRound className="size-4" />}>
            Validar código
          </Button>
        </form>
        <div className="mt-8 rounded-2xl border border-line bg-card p-5">
          <h2 className="font-semibold">¿Aún no tienes un código?</h2>
          <p className="mt-1 text-sm text-muted">
            {String(settings?.["support.message"] ?? "Contáctanos para adquirir tu plan. Al confirmar el pago te enviaremos tu código.")}
          </p>
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#1f8b4c] px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
              <MessageCircle className="size-4" /> Escribir por WhatsApp
            </a>
          )}
        </div>
      </AuthLayout>
    );
  }

  const modality = kind ? MODALITIES[kind] : null;
  // Cuántas herramientas de cada especialidad ya funcionan (para no prometer lo que aún no existe).
  const readiness = (key: string) => {
    const mods = (specMods ?? []).filter((m) => m.specialty_key === key);
    return { ready: mods.filter((m) => isModuleReady(m.module_key, "business")).length, total: mods.length };
  };
  return (
    <AuthLayout
      title={isAdmin ? "Cuenta de administrador" : "Completa tu registro"}
      subtitle={
        isAdmin ? "Este código crea una cuenta con acceso al panel de administración de Eventos360." : (
          <span className="flex flex-wrap items-center gap-2">
            Tu código es para <Badge tone="info">{modality?.product}</Badge>
            <span className="w-full text-sm">Plan {info?.plan_name} · {info?.duration_days} días</span>
          </span>
        )
      }
    >
      <button onClick={() => { setStep("code"); setError(null); }} className="-mt-4 mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Usar otro código
      </button>
      <form onSubmit={register} className="space-y-5" noValidate>
        <Field label="Nombre completo" error={touched ? errors.fullName : null}>
          {(id) => <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />}
        </Field>
        {!isAdmin && kind !== "personal" && (
          <Field label={kind === "business" ? "Nombre comercial de la empresa" : "Nombre de tu marca o actividad"} error={touched ? errors.workspaceName : null}>
            {(id) => <Input id={id} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} autoComplete="organization" />}
          </Field>
        )}
        {kind === "business" && info?.specialties && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-sm font-medium">¿A qué se dedica tu empresa?</span>
              <span className="text-xs text-muted">{presetLocked ? "Definido por tu plan" : `Hasta ${maxSpecs} · la primera es la principal`}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {info.specialties.map((s) => {
                const idx = specs.indexOf(s.key);
                const selected = idx >= 0;
                const Icon = SPECIALTY_ICONS[s.key];
                return (
                  <button key={s.key} type="button" onClick={() => toggleSpec(s.key)} disabled={presetLocked && !selected}
                    aria-pressed={selected}
                    className={cx("flex items-start gap-3 rounded-xl border p-3 text-left transition",
                      selected ? "border-business bg-business-soft" : "border-line bg-card hover:border-line-strong",
                      presetLocked && !selected && "opacity-40")}>
                    <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg", selected ? "bg-business text-white" : "bg-paper text-muted")}>
                      {selected ? <Check className="size-4" /> : Icon ? <Icon className="size-4" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{s.name}{idx === 0 && <span className="ml-1.5 text-xs font-medium text-business">· Principal</span>}</span>
                      <span className="block text-xs text-muted">{s.description}</span>
                      {(() => {
                        const r = readiness(s.key);
                        if (!r.total) return null;
                        return r.ready === r.total
                          ? <span className="mt-1 inline-block rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">Lista para usar</span>
                          : <span className="mt-1 inline-block rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">{r.ready} de {r.total} herramientas listas</span>;
                      })()}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">Todas ya incluyen clientes, cotizaciones, contratos y finanzas. Las herramientas que aún no están listas se activan solas en tu cuenta, sin costo adicional.</p>
            {touched && errors.specs && <p className="mt-1.5 text-xs text-danger">{errors.specs}</p>}
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Usuario" hint="Con este nombre iniciarás sesión." error={touched ? errors.username : null}>
            {(id, d) => (
              <Input id={id} aria-describedby={d} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoComplete="username" autoCapitalize="none" spellCheck={false} />
            )}
          </Field>
          <Field label="Teléfono / WhatsApp" optional>
            {(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="+505 8888 8888" />}
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Contraseña" hint="Mínimo 8 caracteres, con letras y números." error={touched ? errors.password : null}>
            {(id, d) => <Input id={id} aria-describedby={d} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
          </Field>
          <Field label="Repite la contraseña" error={touched ? errors.password2 : null}>
            {(id) => <Input id={id} type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />}
          </Field>
        </div>
        <Alert tone="info">
          Guarda bien tu usuario y contraseña. Por seguridad no usamos correo electrónico: si olvidas tu contraseña, soporte puede restablecerla.
        </Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Crear cuenta
        </Button>
      </form>
    </AuthLayout>
  );
}
