// SPDX-License-Identifier: AGPL-3.0-only
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import RootLayout from "./layout";
import { themeScript } from "./lib/themeScript";

function childrenOf(node: ReactElement): ReactElement[] {
    const children = (node.props as { children?: ReactNode }).children;
    const list = Array.isArray(children) ? children : [children];
    return list.filter((child): child is ReactElement => isValidElement(child));
}

describe("RootLayout", () => {
    const tree = RootLayout({ children: null }) as ReactElement;

    it("suppresses hydration warnings on <html>", () => {
        expect(tree.type).toBe("html");
        expect(
            (tree.props as { suppressHydrationWarning?: boolean })
                .suppressHydrationWarning,
        ).toBe(true);
    });

    it("renders the pre-paint theme script and a theme-color meta in <head>", () => {
        const head = childrenOf(tree).find((child) => child.type === "head");
        expect(head, "layout renders a <head>").toBeTruthy();
        const headChildren = childrenOf(head!);

        const script = headChildren.find((child) => child.type === "script");
        expect(script, "<head> holds the inline script").toBeTruthy();
        expect(
            (
                script!.props as {
                    dangerouslySetInnerHTML?: { __html?: string };
                }
            ).dangerouslySetInnerHTML?.__html,
        ).toBe(themeScript);

        const meta = headChildren.find(
            (child) =>
                child.type === "meta" &&
                (child.props as { name?: string }).name === "theme-color",
        );
        expect(meta, "<head> holds a theme-color meta").toBeTruthy();
    });
});
