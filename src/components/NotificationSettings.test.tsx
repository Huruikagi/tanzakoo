import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { NotificationSettings } from "./NotificationSettings";

vi.mock("@/lib/api", async (original) => {
  const module = await original<typeof import("@/lib/api")>();
  return {
    ...module,
    native: true,
    api: {
      ...module.api,
      notificationSettings: vi.fn(),
      configureNotifications: vi.fn(),
      testNotification: vi.fn(),
    },
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  vi.mocked(api.notificationSettings).mockResolvedValue({
    mode: "inactive",
    permission: "notDetermined",
  });
});

it("does not prompt on opening, requests only on user action, and explains denial", async () => {
  const user = userEvent.setup();
  render(<NotificationSettings />);
  await screen.findByRole("button", { name: "通知を許可する" });
  expect(api.configureNotifications).not.toHaveBeenCalled();
  vi.mocked(api.configureNotifications).mockResolvedValue({
    mode: "inactive",
    permission: "denied",
  });
  vi.mocked(api.notificationSettings).mockResolvedValue({ mode: "inactive", permission: "denied" });
  await user.click(screen.getByRole("button", { name: "通知を許可する" }));
  expect(api.configureNotifications).toHaveBeenCalledWith("inactive");
  await screen.findByText(/OSで通知が無効/);
  expect(screen.queryByRole("button", { name: "通知を許可する" })).not.toBeInTheDocument();
  vi.mocked(api.notificationSettings).mockResolvedValue({
    mode: "inactive",
    permission: "granted",
  });
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByText(/OSで通知が無効/)).not.toBeInTheDocument());
});

it("saves all three modes and tests notifications independently of the automatic policy", async () => {
  let mode: "never" | "inactive" | "always" = "inactive";
  vi.mocked(api.notificationSettings).mockImplementation(async () => ({
    mode,
    permission: "granted",
  }));
  vi.mocked(api.configureNotifications).mockImplementation(async (value) => {
    mode = value;
    return { mode, permission: "granted" };
  });
  const user = userEvent.setup();
  render(<NotificationSettings />);
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  for (const [value, label] of [
    ["always", "常に通知する"],
    ["inactive", "非アクティブ時のみ"],
    ["never", "通知しない"],
  ]) {
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: label }));
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(api.configureNotifications).toHaveBeenLastCalledWith(value);
  }
  vi.mocked(api.testNotification).mockResolvedValue("granted");
  await user.click(screen.getByRole("button", { name: "テスト通知を送る" }));
  await screen.findByText("テスト通知をOSへ送りました。");
  expect(mode).toBe("never");
});

it("keeps the saved mode and shows an error if saving fails", async () => {
  const user = userEvent.setup();
  vi.mocked(api.configureNotifications).mockRejectedValue(new Error("disk full"));
  render(<NotificationSettings />);
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  await user.click(screen.getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: "常に通知する" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("combobox")).toHaveTextContent("非アクティブ時のみ");
});
