export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("auth_token");
}

export function getEmail(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_email");
}

export function logout(): void {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("auth_email");
  window.location.href = "/login";
}
