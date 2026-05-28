import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocsPage } from "../DocsPage";

describe("DocsPage", () => {
  it("documents account response-format management", () => {
    render(<DocsPage />);

    expect(
      screen.getAllByText("/settings/response-format").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Accept: text\/toon/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/response_format": "toon"/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("/auth/accounts/{account_id}/status"),
    ).not.toBeInTheDocument();
  });
});
