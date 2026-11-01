export async function integrationRequest(path = "", body) {
  const response = await fetch("/api/integrations" + path, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Integration request failed");
  return value;
}
export async function pdfAttachment(blob, name) {
  if (blob.size > 3 * 1024 * 1024)
    throw new Error("PDF exceeds 3 MB. Save a smaller PDF before emailing.");
  const content = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return {
    filename:
      String(name)
        .replace(/[^\w .()-]/g, "_")
        .slice(0, 150) + ".pdf",
    content,
  };
}
