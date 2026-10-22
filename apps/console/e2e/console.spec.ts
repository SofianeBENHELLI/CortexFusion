import { test, expect, type Page } from "@playwright/test";
const panel = (p: Page) => p.locator(".panel");
async function proposal(p: Page) {
  await p.goto("/views/validate/PR-3082");
  await expect(
    panel(p).getByRole("heading", {
      name: "SIMULIA — ajouter wave6 au périmètre",
    }),
  ).toBeVisible();
}
async function approve(p: Page) {
  await panel(p)
    .getByRole("button", { name: "Approuver", exact: true })
    .click();
  await p
    .getByLabel("Raison de la décision")
    .fill("Preuve de démonstration vérifiée");
  await panel(p)
    .getByRole("button", { name: "Confirmer", exact: true })
    .click();
  await expect(
    panel(p).getByRole("button", { name: "Publier v42", exact: true }),
  ).toBeVisible();
}
test("approve, fail publication, retry, published answer and persistence", async ({
  page,
}) => {
  await proposal(page);
  await approve(page);
  await expect(page.locator(".conversation-header")).toContainText("v41");
  await page.getByRole("button", { name: "Démo locale" }).click();
  await page.getByLabel("Échec de la prochaine publication").check();
  await page.getByRole("button", { name: "Fermer les scénarios" }).click();
  await panel(page)
    .getByRole("button", { name: "Publier v42", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Confirmer", exact: true })
    .click();
  await expect(
    panel(page).getByText(/Publication en échec à l’étape index/),
  ).toBeVisible();
  await expect(page.locator(".conversation-header")).toContainText("v41");
  await panel(page)
    .getByRole("button", { name: "Réessayer la publication" })
    .click();
  await panel(page)
    .getByRole("button", { name: "Confirmer", exact: true })
    .click();
  await expect(
    panel(page).getByText("Publiée dans v42.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".messages")).toContainText(
    "publication réussie. Le savoir v42 est disponible.",
  );
  await page.reload();
  await expect(page.locator(".conversation-header")).toContainText("v42");
  await page.getByLabel("Votre message").fill("SIMULIA comprend-elle wave6 ?");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(
    page
      .locator(".message-body")
      .getByText("wave6 figure dans le périmètre publié de SIMULIA."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Source · Communiqué_SIMULIA_wave6/ }),
  ).toBeVisible();
});
test("negative feedback creates a linked correction with published data unchanged", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Votre message")
    .fill("Quel est le périmètre de SIMULIA ?");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await page
    .getByRole("button", { name: "Réponse insatisfaisante", exact: true })
    .click();
  await page.getByLabel("Que faut-il améliorer ?").fill("Il manque wave6");
  await page.getByRole("button", { name: "Envoyer le retour" }).click();
  await expect(page.getByText("Retour enregistré")).toBeVisible();
  await page
    .locator("nav")
    .getByRole("button", { name: "Signaux utilisateurs" })
    .click();
  await panel(page)
    .getByRole("button", { name: /Quel est le périmètre de SIMULIA/ })
    .click();
  await page
    .getByRole("button", { name: "Créer une correction", exact: true })
    .click();
  await panel(page).getByLabel("Cible de la relation").fill("wave6");
  await panel(page).getByLabel("Source justificative").selectOption("SRC-002");
  await panel(page)
    .getByLabel("Justification")
    .fill("La source confirme wave6.");
  await panel(page)
    .getByLabel("J’ai vérifié que cette source étaye le changement.")
    .check();
  await panel(page)
    .getByRole("button", { name: "Créer une proposition", exact: true })
    .click();
  await expect(
    panel(page).locator(".tag").getByText("À valider", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".conversation-header")).toContainText("v41");
});
test("import text to proposal; PDF refusal is explicit", async ({ page }) => {
  await page.goto("/views/sources");
  await page.locator("input[type=file]").setInputFiles({
    name: "Domaine.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Nouveau concept\nUne preuve de démonstration."),
  });
  await panel(page).getByLabel("Nom du concept").fill("Atelier Démo");
  await panel(page)
    .getByLabel("Description du concept")
    .fill("Un espace de formation fictif.");
  await panel(page)
    .getByLabel("Cible de la relation")
    .fill("Parcours de découverte");
  await panel(page)
    .getByLabel("Justification")
    .fill("Texte synthétique examiné.");
  await panel(page)
    .getByLabel("J’ai vérifié que cette source étaye le changement.")
    .check();
  await panel(page)
    .getByRole("button", { name: "Créer une proposition", exact: true })
    .click();
  await expect(
    panel(page).getByRole("heading", {
      name: "Atelier Démo — nouveau concept",
    }),
  ).toBeVisible();
  await page
    .locator("nav")
    .getByRole("button", { name: "Sources & imports" })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF"),
  });
  await expect(
    panel(page).getByText(/Le mock accepte TXT et Markdown/),
  ).toBeVisible();
});
test("reader cannot mutate; admin route is denied; unknown detail and search empty state", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Démo locale" }).click();
  await page.getByLabel("Tester avec le rôle").selectOption("viewer");
  await page
    .locator("nav")
    .getByRole("button", { name: /À valider/ })
    .click();
  await panel(page)
    .getByRole("button", { name: /SIMULIA — ajouter wave6/ })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "Approuver", exact: true }),
  ).toBeDisabled();
  await page.goto("/views/admin");
  await expect(
    panel(page).getByText("Cette vue est réservée à l’administrateur."),
  ).toBeVisible();
  await page.goto("/views/validate");
  await page.getByLabel("Filtrer la vue").fill("introuvable-xyz");
  await expect(panel(page).getByText(/Aucun résultat/)).toBeVisible();
  await page.goto("/views/validate/inconnu");
  await expect(
    panel(page).getByText(/introuvable ou inaccessible/),
  ).toBeVisible();
});
test("chat approval is confirmation only, and no external network requests", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:5173/")) external.push(r.url());
  });
  await page.goto("/");
  await page.getByLabel("Votre message").fill("Approuve PR-3082");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(
    panel(page).getByRole("heading", { name: "Confirmer l’approbation ?" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Confirmer", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".conversation-header")).toContainText("v41");
  expect(external).toEqual([]);
});
test("responsive panel, close/reopen, history and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/views/concepts/simulia");
  await expect(
    panel(page).getByRole("heading", { name: "SIMULIA", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Fermer la vue" }).click();
  await page.getByRole("button", { name: "Afficher la vue" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nouvelle conversation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Administration", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Historique des conversations" })
    .click();
  const history = page.getByRole("dialog", {
    name: "Conversations",
    exact: true,
  });
  await expect(history).toBeVisible();
  await expect(
    history.getByRole("button", { name: "Concepts & relations", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(history).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Historique des conversations" }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Historique des conversations" })
    .click();
  await history
    .getByRole("button", { name: "Concepts & relations", exact: true })
    .click();
  await expect(history).not.toBeVisible();
});

test("implicit action binds current proposal and never guesses", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Votre message").fill("Approuve cette proposition");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(
    page.getByText(
      "Je ne trouve pas cette proposition. Ouvrez « À valider » pour choisir un élément.",
    ),
  ).toBeVisible();
  await page.goto("/views/validate/PR-3081");
  await page.getByLabel("Votre message").fill("Approuve cette proposition");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(
    panel(page).getByRole("heading", { name: "Confirmer l’approbation ?" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/PR-3081$/);
  await expect(
    panel(page).getByRole("heading", {
      name: "3DEXCITE — clarifier le périmètre",
    }),
  ).toBeVisible();
});
