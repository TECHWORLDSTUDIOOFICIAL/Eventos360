import { Link } from "react-router";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-4">
      <div className="text-center">
        <Logo className="justify-center" />
        <h1 className="mt-8 font-display text-5xl font-semibold">Página no encontrada</h1>
        <p className="mt-3 text-muted">La dirección no existe o no tienes acceso a ella.</p>
        <Link to="/" className="mt-6 inline-block font-semibold text-brand underline-offset-4 hover:underline">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
