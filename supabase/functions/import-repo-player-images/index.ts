// Die einmalige Übernahme der Repository-Profilbilder ist abgeschlossen; die Function ist stillgelegt.
Deno.serve(() => new Response(JSON.stringify({ error: "Stillgelegt." }), {
  status: 410,
  headers: { "Content-Type": "application/json" },
}));
