import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HomeContent } from "@/app/components/site/HomeContent";
import { SiteShell } from "@/app/components/site/SiteShell";
import { hasSessionCookie } from "@/app/lib/sessionCookie";
import { siteEnabled, siteRobotsMetadata } from "@/app/lib/siteFlags";
import { HOME_COPY } from "@/content/site/home";

// Read per request: the session cookie decides who sees the home page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    description: HOME_COPY.lede,
    robots: siteRobotsMetadata(),
};

/**
 * The root of the site. With NEXT_PUBLIC_SITE_ENABLED=true baked into the
 * build, a signed-out visitor sees the public home page; a browser that
 * carries a session cookie goes to the app, as everyone did before the site
 * existed, and still does when the flag is off. The cookie is only looked
 * for, never read: a stale one lands on the app, which asks the API and
 * shows the sign-in page.
 */
export default async function RootPage() {
    if (!siteEnabled()) redirect("/assistant");
    const jar = await cookies();
    if (hasSessionCookie(jar.getAll().map((cookie) => cookie.name))) {
        redirect("/assistant");
    }
    return (
        <SiteShell>
            <HomeContent />
        </SiteShell>
    );
}
