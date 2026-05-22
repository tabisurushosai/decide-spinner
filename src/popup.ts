const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Popup root element was not found.");
}

const t = (key: string, substitutions?: string | string[]): string => {
  const message = chrome.i18n.getMessage(key, substitutions);
  return message || key;
};

type Choice = {
  id: string;
  label: string;
  weight?: number;
};

type ChoiceList = {
  id: string;
  name: string;
  choices: Choice[];
};

type HistoryEntry = {
  id: string;
  label: string;
  listName: string;
  selectedAt: string;
};

type CurrentResult = {
  label: string;
  listId: string;
};

type StorageState = {
  lists: ChoiceList[];
  activeListId: string;
  history: HistoryEntry[];
  currentResult: CurrentResult | null;
  premium: PremiumState;
};

type PremiumState = {
  trialStartedAt: string | null;
};

const LEGACY_CHOICES_STORAGE_KEY = "decideSpinnerChoices";
const LISTS_STORAGE_KEY = "decideSpinnerLists";
const ACTIVE_LIST_STORAGE_KEY = "decideSpinnerActiveListId";
const HISTORY_STORAGE_KEY = "decideSpinnerHistory";
const CURRENT_RESULT_STORAGE_KEY = "decideSpinnerCurrentResult";
const PREMIUM_STORAGE_KEY = "decideSpinnerPremium";
const DEFAULT_LIST_NAME = t("defaultListName");
const DEFAULT_RESULT_TEXT = t("defaultResultText");
const HISTORY_LIMIT = 10;
const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const STRIPE_CHECKOUT_URL = "https://checkout.stripe.com/c/pay/decide-spinner-premium";

let choiceLists: ChoiceList[] = [];
let activeListId = "";
let historyEntries: HistoryEntry[] = [];
let currentResult: CurrentResult | null = null;
let premiumState: PremiumState = { trialStartedAt: null };
let isSpinning = false;
let listSelect: HTMLSelectElement | undefined;
let deleteListButton: HTMLButtonElement | undefined;
let newListButton: HTMLButtonElement | undefined;
let spinButton: HTMLButtonElement | undefined;
let rouletteWheel: HTMLDivElement | undefined;
let rouletteLabel: HTMLSpanElement | undefined;
let result: HTMLDivElement | undefined;
let historyList: HTMLUListElement | undefined;
let historyEmptyMessage: HTMLParagraphElement | undefined;
let premiumStatus: HTMLParagraphElement | undefined;
let trialButton: HTMLButtonElement | undefined;

const createChoiceId = (): string =>
  `choice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const createListId = (): string =>
  `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const createHistoryId = (): string =>
  `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const isChoice = (value: unknown): value is Choice => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Choice>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    (candidate.weight === undefined || typeof candidate.weight === "number")
  );
};

const isChoiceList = (value: unknown): value is ChoiceList => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ChoiceList>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.choices) &&
    candidate.choices.every(isChoice)
  );
};

const isHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<HistoryEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.listName === "string" &&
    typeof candidate.selectedAt === "string"
  );
};

const isCurrentResult = (value: unknown): value is CurrentResult => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CurrentResult>;
  return typeof candidate.label === "string" && typeof candidate.listId === "string";
};

const isPremiumState = (value: unknown): value is PremiumState => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PremiumState>;
  return candidate.trialStartedAt === null || typeof candidate.trialStartedAt === "string";
};

const normalizeWeight = (weight: unknown): number => {
  if (typeof weight !== "number" || !Number.isFinite(weight)) {
    return 1;
  }

  return Math.min(99, Math.max(1, Math.round(weight)));
};

const isTrialActive = (): boolean => {
  if (!premiumState.trialStartedAt) {
    return false;
  }

  const startedAt = new Date(premiumState.trialStartedAt).getTime();
  return Number.isFinite(startedAt) && Date.now() - startedAt < TRIAL_DURATION_MS;
};

const getTrialDaysLeft = (): number => {
  if (!premiumState.trialStartedAt) {
    return 0;
  }

  const startedAt = new Date(premiumState.trialStartedAt).getTime();
  if (!Number.isFinite(startedAt)) {
    return 0;
  }

  return Math.max(0, Math.ceil((TRIAL_DURATION_MS - (Date.now() - startedAt)) / 86400000));
};

const isPremiumActive = (): boolean => isTrialActive();

const ensureActiveListIsAllowed = (): void => {
  if (isPremiumActive() || choiceLists.length === 0) {
    return;
  }

  activeListId = choiceLists[0].id;
};

const createEmptyList = (name = DEFAULT_LIST_NAME): ChoiceList => ({
  id: createListId(),
  name,
  choices: [],
});

const getActiveList = (): ChoiceList => {
  if (choiceLists.length === 0) {
    const list = createEmptyList();
    choiceLists = [list];
    activeListId = list.id;
    return list;
  }

  let activeList = choiceLists.find((list) => list.id === activeListId);

  if (!activeList) {
    activeList = choiceLists[0];
    activeListId = activeList.id;
  }

  return activeList;
};

const loadState = async (): Promise<StorageState> => {
  const stored = await chrome.storage.local.get([
    LISTS_STORAGE_KEY,
    ACTIVE_LIST_STORAGE_KEY,
    LEGACY_CHOICES_STORAGE_KEY,
    HISTORY_STORAGE_KEY,
    CURRENT_RESULT_STORAGE_KEY,
    PREMIUM_STORAGE_KEY,
  ]);
  const storedLists = stored[LISTS_STORAGE_KEY];
  const storedActiveListId = stored[ACTIVE_LIST_STORAGE_KEY];
  const storedHistory = stored[HISTORY_STORAGE_KEY];
  const storedCurrentResult = stored[CURRENT_RESULT_STORAGE_KEY];
  const storedPremium = stored[PREMIUM_STORAGE_KEY];
  const premium = isPremiumState(storedPremium) ? storedPremium : { trialStartedAt: null };
  const history = Array.isArray(storedHistory)
    ? storedHistory.filter(isHistoryEntry).slice(0, HISTORY_LIMIT)
    : [];
  const resultState = isCurrentResult(storedCurrentResult) ? storedCurrentResult : null;

  if (Array.isArray(storedLists)) {
    const lists = storedLists.filter(isChoiceList);

    if (lists.length > 0) {
      const activeId =
        typeof storedActiveListId === "string" &&
        lists.some((list) => list.id === storedActiveListId)
          ? storedActiveListId
          : lists[0].id;
      const currentResult =
        resultState && resultState.listId === activeId ? resultState : null;

      return { lists, activeListId: activeId, history, currentResult, premium };
    }
  }

  const legacyChoices = stored[LEGACY_CHOICES_STORAGE_KEY];
  const migratedList = createEmptyList();

  if (Array.isArray(legacyChoices)) {
    migratedList.choices = legacyChoices.filter(isChoice);
  }

  const currentResult =
    resultState && resultState.listId === migratedList.id ? resultState : null;

  return { lists: [migratedList], activeListId: migratedList.id, history, currentResult, premium };
};

const saveState = async (): Promise<void> => {
  await chrome.storage.local.set({
    [LISTS_STORAGE_KEY]: choiceLists,
    [ACTIVE_LIST_STORAGE_KEY]: activeListId,
    [HISTORY_STORAGE_KEY]: historyEntries,
    [CURRENT_RESULT_STORAGE_KEY]: currentResult,
    [PREMIUM_STORAGE_KEY]: premiumState,
  });
};

const persistAndRender = async (
  listElement: HTMLUListElement,
  emptyElement: HTMLParagraphElement,
): Promise<void> => {
  await saveState();
  renderPremiumGate();
  renderListControls();
  renderChoices(listElement, emptyElement);
};

const getChoiceColor = (index: number): string => {
  const colors = ["#f97316", "#14b8a6", "#4f46e5", "#e11d48", "#84cc16", "#0ea5e9"];
  return colors[index % colors.length];
};

const renderRouletteWheel = (): void => {
  if (!rouletteWheel || !rouletteLabel) {
    return;
  }

  const choices = getActiveList().choices;

  if (choices.length === 0) {
    rouletteWheel.style.background = "#eef2f7";
    rouletteLabel.textContent = "-";
    return;
  }

  const weights = choices.map((choice) =>
    isPremiumActive() ? normalizeWeight(choice.weight) : 1,
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  const stops = choices.map((_, index) => {
    const start = (cursor / totalWeight) * 100;
    cursor += weights[index];
    const end = (cursor / totalWeight) * 100;
    return `${getChoiceColor(index)} ${start}% ${end}%`;
  });

  rouletteWheel.style.background = `conic-gradient(${stops.join(", ")})`;
  rouletteLabel.textContent = choices.length.toString();
};

const updateSpinState = (): void => {
  const choices = getActiveList().choices;

  if (spinButton) {
    spinButton.disabled = choices.length === 0 || isSpinning;
  }

  renderRouletteWheel();
};

const renderResult = (): void => {
  if (!result) {
    return;
  }

  result.textContent =
    currentResult && currentResult.listId === activeListId
      ? currentResult.label
      : DEFAULT_RESULT_TEXT;
};

const resetResult = (): void => {
  currentResult = null;
  renderResult();
};

const renderHistory = (): void => {
  if (!historyList || !historyEmptyMessage) {
    return;
  }

  historyList.replaceChildren();
  historyEmptyMessage.hidden = historyEntries.length > 0;

  for (const entry of historyEntries) {
    const item = document.createElement("li");
    item.className = "history-item";

    const label = document.createElement("span");
    label.className = "history-label";
    label.textContent = entry.label;

    const details = document.createElement("span");
    details.className = "history-details";
    details.textContent = t("historyDetails", [
      entry.listName,
      new Date(entry.selectedAt).toLocaleString(chrome.i18n.getUILanguage()),
    ]);

    item.append(label, details);
    historyList.append(item);
  }
};

const addHistoryEntry = async (choice: Choice, list: ChoiceList): Promise<void> => {
  historyEntries = [
    {
      id: createHistoryId(),
      label: choice.label,
      listName: list.name,
      selectedAt: new Date().toISOString(),
    },
    ...historyEntries,
  ].slice(0, HISTORY_LIMIT);

  renderHistory();
  await saveState();
};

const renderListControls = (): void => {
  if (!listSelect || !deleteListButton || !newListButton) {
    return;
  }

  ensureActiveListIsAllowed();
  listSelect.replaceChildren();

  const visibleLists = isPremiumActive() ? choiceLists : choiceLists.slice(0, 1);

  for (const list of visibleLists) {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    listSelect.append(option);
  }

  listSelect.value = activeListId;
  listSelect.disabled = !isPremiumActive() || visibleLists.length <= 1;
  newListButton.disabled = !isPremiumActive();
  deleteListButton.disabled = !isPremiumActive() || choiceLists.length <= 1;
};

const renderPremiumGate = (): void => {
  if (!premiumStatus || !trialButton) {
    return;
  }

  if (isTrialActive()) {
    premiumStatus.textContent = t("premiumActiveStatus", String(getTrialDaysLeft()));
    trialButton.disabled = true;
    trialButton.textContent = t("trialActiveButton");
    return;
  }

  if (premiumState.trialStartedAt) {
    premiumStatus.textContent = t("premiumExpiredStatus");
    trialButton.disabled = true;
    trialButton.textContent = t("trialExpiredButton");
    return;
  }

  premiumStatus.textContent = t("premiumFreeStatus");
  trialButton.disabled = false;
  trialButton.textContent = t("startTrialButton");
};

const renderChoices = (listElement: HTMLUListElement, emptyElement: HTMLParagraphElement): void => {
  ensureActiveListIsAllowed();
  const choices = getActiveList().choices;

  listElement.replaceChildren();

  emptyElement.hidden = choices.length > 0;

  for (const choice of choices) {
    const item = document.createElement("li");
    item.className = "choice-item";
    if (isPremiumActive()) {
      item.classList.add("has-weight");
    }

    const label = document.createElement("span");
    label.textContent = choice.label;

    const weightInput = document.createElement("input");
    weightInput.type = "number";
    weightInput.className = "weight-input";
    weightInput.min = "1";
    weightInput.max = "99";
    weightInput.step = "1";
    weightInput.value = String(normalizeWeight(choice.weight));
    weightInput.setAttribute("aria-label", t("weightInputAria", choice.label));
    weightInput.addEventListener("change", () => {
      choice.weight = normalizeWeight(Number(weightInput.value));
      weightInput.value = String(choice.weight);
      void persistAndRender(listElement, emptyElement);
    });

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "action-button";
    editButton.setAttribute("aria-label", t("editChoiceAria", choice.label));
    editButton.textContent = t("editChoiceButton");
    editButton.addEventListener("click", () => {
      const nextLabel = window.prompt(t("editChoicePrompt"), choice.label)?.trim();
      if (!nextLabel) {
        return;
      }

      const target = choices.find((entry) => entry.id === choice.id);
      if (target) {
        target.label = nextLabel;
        void persistAndRender(listElement, emptyElement);
      }
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "icon-button";
    removeButton.setAttribute("aria-label", t("deleteChoiceAria", choice.label));
    removeButton.textContent = "x";
    removeButton.addEventListener("click", () => {
      const index = choices.findIndex((entry) => entry.id === choice.id);
      if (index >= 0) {
        choices.splice(index, 1);
        void persistAndRender(listElement, emptyElement);
      }
    });

    if (isPremiumActive()) {
      item.append(label, weightInput, editButton, removeButton);
    } else {
      item.append(label, editButton, removeButton);
    }
    listElement.append(item);
  }

  updateSpinState();
};

const style = document.createElement("style");
style.textContent = `
  :root {
    color: #1f2937;
    background: #f8fafc;
  }

  body {
    margin: 0;
  }

  #app {
    display: grid;
    gap: 14px;
  }

  .panel {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid #d8dee8;
    border-radius: 8px;
    background: #ffffff;
  }

  .field-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }

  .list-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    gap: 8px;
  }

  input,
  select,
  button {
    font: inherit;
  }

  input,
  select {
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid #b9c2d0;
    border-radius: 6px;
    background: #ffffff;
  }

  button {
    min-height: 36px;
    border: 1px solid #244a73;
    border-radius: 6px;
    background: #2f6ea5;
    color: #ffffff;
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .choice-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .choice-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 32px;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 8px 0 10px;
    border: 1px solid #e1e6ee;
    border-radius: 6px;
    background: #f9fbfd;
  }

  .choice-item.has-weight {
    grid-template-columns: minmax(0, 1fr) 54px auto 32px;
  }

  .choice-item span {
    overflow-wrap: anywhere;
  }

  .history-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .premium-status {
    margin: 0;
    color: #536172;
    font-size: 13px;
  }

  .checkout-url {
    margin: 0;
    padding: 8px;
    border: 1px solid #e1e6ee;
    border-radius: 6px;
    background: #f9fbfd;
    color: #374151;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .weight-input {
    width: 54px;
    padding: 6px;
  }

  .history-item {
    display: grid;
    gap: 2px;
    min-height: 42px;
    padding: 8px 10px;
    border: 1px solid #e1e6ee;
    border-radius: 6px;
    background: #f9fbfd;
  }

  .history-label {
    color: #1f2937;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .history-details {
    color: #6b7280;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .icon-button {
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    border-color: #c6ced9;
    background: #ffffff;
    color: #536172;
  }

  .action-button {
    min-width: 44px;
    min-height: 32px;
    padding: 0 8px;
    border-color: #c6ced9;
    background: #ffffff;
    color: #536172;
  }

  .result {
    min-height: 42px;
    display: grid;
    place-items: center;
    padding: 10px;
    border: 1px dashed #9aa8ba;
    border-radius: 8px;
    color: #536172;
    text-align: center;
  }

  .roulette-stage {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 10px;
  }

  .roulette-pointer {
    width: 0;
    height: 0;
    border-right: 9px solid transparent;
    border-left: 9px solid transparent;
    border-top: 14px solid #1f2937;
    z-index: 1;
  }

  .roulette-wheel {
    position: relative;
    width: 156px;
    height: 156px;
    border: 6px solid #ffffff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px #cfd8e3, 0 10px 24px rgb(31 41 55 / 16%);
    transform: rotate(0deg);
  }

  .roulette-wheel.is-spinning {
    animation: roulette-spin 1.4s cubic-bezier(0.12, 0.72, 0.18, 1) forwards;
  }

  .roulette-center {
    position: absolute;
    inset: 50%;
    display: grid;
    place-items: center;
    width: 54px;
    height: 54px;
    border: 1px solid #d7dee8;
    border-radius: 50%;
    background: #ffffff;
    color: #1f2937;
    font-size: 13px;
    font-weight: 700;
    transform: translate(-50%, -50%);
  }

  .spin-button {
    width: 100%;
  }

  @keyframes roulette-spin {
    from {
      transform: rotate(0deg);
    }

    to {
      transform: rotate(var(--spin-target, 1080deg));
    }
  }

  .section-title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
  }

  .empty {
    margin: 0;
    color: #6b7280;
    font-size: 13px;
  }
`;
document.head.append(style);

app.replaceChildren();

document.documentElement.lang = chrome.i18n.getUILanguage();
document.title = t("extName");
document.querySelector("h3")?.replaceChildren(t("extName"));

listSelect = document.createElement("select");
listSelect.setAttribute("aria-label", t("selectListAria"));

newListButton = document.createElement("button");
newListButton.type = "button";
newListButton.textContent = t("newListButton");

const renameListButton = document.createElement("button");
renameListButton.type = "button";
renameListButton.textContent = t("renameListButton");

deleteListButton = document.createElement("button");
deleteListButton.type = "button";
deleteListButton.textContent = t("deleteListButton");

const listControls = document.createElement("div");
listControls.className = "list-row";
listControls.append(listSelect, newListButton, renameListButton, deleteListButton);

const input = document.createElement("input");
input.type = "text";
input.placeholder = t("choiceInputPlaceholder");
input.autocomplete = "off";
input.maxLength = 80;
input.setAttribute("aria-label", t("choiceInputAria"));

const addButton = document.createElement("button");
addButton.type = "submit";
addButton.textContent = t("addChoiceButton");

const form = document.createElement("form");
form.className = "field-row";
form.append(input, addButton);

const listTitle = document.createElement("p");
listTitle.className = "section-title";
listTitle.textContent = t("choicesTitle");

const emptyMessage = document.createElement("p");
emptyMessage.className = "empty";
emptyMessage.textContent = t("emptyChoicesText");

const choiceList = document.createElement("ul");
choiceList.className = "choice-list";

const choicePanel = document.createElement("section");
choicePanel.className = "panel";
choicePanel.append(listControls, form, listTitle, emptyMessage, choiceList);

const premiumTitle = document.createElement("p");
premiumTitle.className = "section-title";
premiumTitle.textContent = t("premiumTitle");

premiumStatus = document.createElement("p");
premiumStatus.className = "premium-status";

trialButton = document.createElement("button");
trialButton.type = "button";

const checkoutUrl = document.createElement("p");
checkoutUrl.className = "checkout-url";
checkoutUrl.textContent = t("checkoutUrlLabel", STRIPE_CHECKOUT_URL);

const premiumPanel = document.createElement("section");
premiumPanel.className = "panel";
premiumPanel.append(premiumTitle, premiumStatus, trialButton, checkoutUrl);

const resultTitle = document.createElement("p");
resultTitle.className = "section-title";
resultTitle.textContent = t("resultTitle");

const rouletteStage = document.createElement("div");
rouletteStage.className = "roulette-stage";

const roulettePointer = document.createElement("div");
roulettePointer.className = "roulette-pointer";
roulettePointer.setAttribute("aria-hidden", "true");

rouletteWheel = document.createElement("div");
rouletteWheel.className = "roulette-wheel";
rouletteWheel.setAttribute("aria-hidden", "true");

const rouletteCenter = document.createElement("div");
rouletteCenter.className = "roulette-center";

rouletteLabel = document.createElement("span");
rouletteLabel.textContent = "-";
rouletteCenter.append(rouletteLabel);
rouletteWheel.append(rouletteCenter);

rouletteStage.append(roulettePointer, rouletteWheel);

spinButton = document.createElement("button");
spinButton.type = "button";
spinButton.className = "spin-button";
spinButton.textContent = t("spinButton");
spinButton.disabled = true;

result = document.createElement("div");
result.className = "result";
result.setAttribute("aria-live", "polite");
result.textContent = DEFAULT_RESULT_TEXT;

const resultPanel = document.createElement("section");
resultPanel.className = "panel";
resultPanel.append(resultTitle, rouletteStage, spinButton, result);

const historyTitle = document.createElement("p");
historyTitle.className = "section-title";
historyTitle.textContent = t("historyTitle");

historyEmptyMessage = document.createElement("p");
historyEmptyMessage.className = "empty";
historyEmptyMessage.textContent = t("emptyHistoryText");

historyList = document.createElement("ul");
historyList.className = "history-list";

const historyPanel = document.createElement("section");
historyPanel.className = "panel";
historyPanel.append(historyTitle, historyEmptyMessage, historyList);

listSelect.addEventListener("change", () => {
  activeListId = listSelect?.value ?? activeListId;
  resetResult();
  void persistAndRender(choiceList, emptyMessage);
});

newListButton.addEventListener("click", () => {
  if (!isPremiumActive()) {
    window.alert(t("premiumRequiredAlert"));
    return;
  }

  const name = window
    .prompt(t("newListPrompt"), t("defaultListNameWithNumber", String(choiceLists.length + 1)))
    ?.trim();

  if (!name) {
    return;
  }

  const list = createEmptyList(name);
  choiceLists.push(list);
  activeListId = list.id;
  resetResult();
  void persistAndRender(choiceList, emptyMessage);
});

renameListButton.addEventListener("click", () => {
  const activeList = getActiveList();
  const name = window.prompt(t("renameListPrompt"), activeList.name)?.trim();

  if (!name) {
    return;
  }

  activeList.name = name;
  void persistAndRender(choiceList, emptyMessage);
});

deleteListButton.addEventListener("click", () => {
  const activeList = getActiveList();

  if (choiceLists.length <= 1 || !window.confirm(t("deleteListConfirm", activeList.name))) {
    return;
  }

  const nextLists = choiceLists.filter((list) => list.id !== activeList.id);
  choiceLists = nextLists.length > 0 ? nextLists : [createEmptyList()];
  activeListId = choiceLists[0].id;
  resetResult();
  void persistAndRender(choiceList, emptyMessage);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = input.value.trim();
  if (!label) {
    input.focus();
    return;
  }

  getActiveList().choices.push({ id: createChoiceId(), label, weight: 1 });
  input.value = "";
  void persistAndRender(choiceList, emptyMessage);
  input.focus();
});

spinButton.addEventListener("click", () => {
  const activeList = getActiveList();
  const choices = activeList.choices;

  if (isSpinning || choices.length === 0 || !rouletteWheel || !result) {
    return;
  }

  const weights = choices.map((choice) =>
    isPremiumActive() ? normalizeWeight(choice.weight) : 1,
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = Math.random() * totalWeight;
  let selectedIndex = 0;

  for (const [index, weight] of weights.entries()) {
    threshold -= weight;
    if (threshold <= 0) {
      selectedIndex = index;
      break;
    }
  }

  const selectedChoice = choices[selectedIndex];
  const segmentAngle = 360 / choices.length;
  const segmentCenter = selectedIndex * segmentAngle + segmentAngle / 2;
  const targetRotation = 360 * 4 + (360 - segmentCenter);

  isSpinning = true;
  result.textContent = t("spinningText");
  rouletteWheel.classList.remove("is-spinning");
  rouletteWheel.style.setProperty("--spin-target", `${targetRotation}deg`);
  void rouletteWheel.offsetWidth;
  rouletteWheel.classList.add("is-spinning");
  updateSpinState();

  window.setTimeout(() => {
    isSpinning = false;
    rouletteWheel?.classList.remove("is-spinning");
    rouletteWheel?.style.setProperty("transform", `rotate(${targetRotation}deg)`);
    currentResult = { label: selectedChoice.label, listId: activeList.id };
    if (result) {
      renderResult();
    }
    void addHistoryEntry(selectedChoice, activeList);
    updateSpinState();
  }, 1400);
});

trialButton.addEventListener("click", () => {
  if (premiumState.trialStartedAt) {
    return;
  }

  premiumState = { trialStartedAt: new Date().toISOString() };
  void persistAndRender(choiceList, emptyMessage);
});

app.append(choicePanel, premiumPanel, resultPanel, historyPanel);

const initialize = async (): Promise<void> => {
  const state = await loadState();
  choiceLists = state.lists.length > 0 ? state.lists : [createEmptyList()];
  activeListId = state.activeListId;
  historyEntries = state.history;
  currentResult = state.currentResult;
  premiumState = state.premium;
  ensureActiveListIsAllowed();
  renderPremiumGate();
  renderListControls();
  renderChoices(choiceList, emptyMessage);
  renderResult();
  renderHistory();
};

void initialize();
