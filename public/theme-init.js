// Sets the dark class before the first paint, so a dark page never flashes light while the app loads. The docs site reads the same key.
try {
  var t = localStorage.getItem("theme") || "system";
  if (t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
} catch (e) {}
