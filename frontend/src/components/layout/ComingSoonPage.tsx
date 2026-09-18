export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">Próxima etapa.</p>
    </div>
  );
}
