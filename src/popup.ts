const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Popup root element was not found.");
}

type Choice = {
  id: string;
  label: string;
};

type ChoiceList = {
  id: string;
  name: string;
  choices: Choice[];
};

type StorageState = {
  lists: ChoiceList[];
  activeListId: string;
};

const LEGACY_CHOICES_STORAGE_KEY = "decideSpinnerChoices";
const LISTS_STORAGE_KEY = "decideSpinnerLists";
const ACTIVE_LIST_STORAGE_KEY = "decideSpinnerActiveListId";
const DEFAULT_LIST_NAME = "リスト 1";

let choiceLists: ChoiceList[] = [];
let activeListId = "";
let isSpinning = false;
let listSelect: HTMLSelectElement | undefined;
let deleteListButton: HTMLButtonElement | undefined;
let spinButton: HTMLButtonElement | undefined;
let rouletteWheel: HTMLDivElement | undefined;
let rouletteLabel: HTMLSpanElement | undefined;
let result: HTMLDivElement | undefined;

const createChoiceId = (): string =>
  `choice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const createListId = (): string =>
  `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const isChoice = (value: unknown): value is Choice => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Choice>;
  return typeof candidate.id === "string" && typeof candidate.label === "string";
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
  ]);
  const storedLists = stored[LISTS_STORAGE_KEY];
  const storedActiveListId = stored[ACTIVE_LIST_STORAGE_KEY];

  if (Array.isArray(storedLists)) {
    const lists = storedLists.filter(isChoiceList);

    if (lists.length > 0) {
      const activeId =
        typeof storedActiveListId === "string" &&
        lists.some((list) => list.id === storedActiveListId)
          ? storedActiveListId
          : lists[0].id;

      return { lists, activeListId: activeId };
    }
  }

  const legacyChoices = stored[LEGACY_CHOICES_STORAGE_KEY];
  const migratedList = createEmptyList();

  if (Array.isArray(legacyChoices)) {
    migratedList.choices = legacyChoices.filter(isChoice);
  }

  return { lists: [migratedList], activeListId: migratedList.id };
};

const saveState = async (): Promise<void> => {
  await chrome.storage.local.set({
    [LISTS_STORAGE_KEY]: choiceLists,
    [ACTIVE_LIST_STORAGE_KEY]: activeListId,
  });
};

const persistAndRender = async (
  listElement: HTMLUListElement,
  emptyElement: HTMLParagraphElement,
): Promise<void> => {
  await saveState();
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

  const segmentSize = 100 / choices.length;
  const stops = choices.map((_, index) => {
    const start = segmentSize * index;
    const end = segmentSize * (index + 1);
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

const renderListControls = (): void => {
  if (!listSelect || !deleteListButton) {
    return;
  }

  listSelect.replaceChildren();

  for (const list of choiceLists) {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    listSelect.append(option);
  }

  listSelect.value = activeListId;
  deleteListButton.disabled = choiceLists.length <= 1;
};

const renderChoices = (listElement: HTMLUListElement, emptyElement: HTMLParagraphElement): void => {
  const choices = getActiveList().choices;

  listElement.replaceChildren();

  emptyElement.hidden = choices.length > 0;

  for (const choice of choices) {
    const item = document.createElement("li");
    item.className = "choice-item";

    const label = document.createElement("span");
    label.textContent = choice.label;

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "action-button";
    editButton.setAttribute("aria-label", `${choice.label} を編集`);
    editButton.textContent = "編集";
    editButton.addEventListener("click", () => {
      const nextLabel = window.prompt("選択肢を編集", choice.label)?.trim();
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
    removeButton.setAttribute("aria-label", `${choice.label} を削除`);
    removeButton.textContent = "x";
    removeButton.addEventListener("click", () => {
      const index = choices.findIndex((entry) => entry.id === choice.id);
      if (index >= 0) {
        choices.splice(index, 1);
        void persistAndRender(listElement, emptyElement);
      }
    });

    item.append(label, editButton, removeButton);
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

  .choice-item span {
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

listSelect = document.createElement("select");
listSelect.setAttribute("aria-label", "リストを選択");

const newListButton = document.createElement("button");
newListButton.type = "button";
newListButton.textContent = "新規";

const renameListButton = document.createElement("button");
renameListButton.type = "button";
renameListButton.textContent = "名前";

deleteListButton = document.createElement("button");
deleteListButton.type = "button";
deleteListButton.textContent = "削除";

const listControls = document.createElement("div");
listControls.className = "list-row";
listControls.append(listSelect, newListButton, renameListButton, deleteListButton);

const input = document.createElement("input");
input.type = "text";
input.placeholder = "選択肢を入力";
input.autocomplete = "off";
input.maxLength = 80;
input.setAttribute("aria-label", "選択肢");

const addButton = document.createElement("button");
addButton.type = "submit";
addButton.textContent = "追加";

const form = document.createElement("form");
form.className = "field-row";
form.append(input, addButton);

const listTitle = document.createElement("p");
listTitle.className = "section-title";
listTitle.textContent = "選択肢";

const emptyMessage = document.createElement("p");
emptyMessage.className = "empty";
emptyMessage.textContent = "まだ選択肢がありません。";

const choiceList = document.createElement("ul");
choiceList.className = "choice-list";

const choicePanel = document.createElement("section");
choicePanel.className = "panel";
choicePanel.append(listControls, form, listTitle, emptyMessage, choiceList);

const resultTitle = document.createElement("p");
resultTitle.className = "section-title";
resultTitle.textContent = "結果";

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
spinButton.textContent = "回す";
spinButton.disabled = true;

result = document.createElement("div");
result.className = "result";
result.setAttribute("aria-live", "polite");
result.textContent = "ここに結果が表示されます。";

const resultPanel = document.createElement("section");
resultPanel.className = "panel";
resultPanel.append(resultTitle, rouletteStage, spinButton, result);

listSelect.addEventListener("change", () => {
  activeListId = listSelect?.value ?? activeListId;
  if (result) {
    result.textContent = "ここに結果が表示されます。";
  }
  void persistAndRender(choiceList, emptyMessage);
});

newListButton.addEventListener("click", () => {
  const name = window.prompt("新しいリスト名", `リスト ${choiceLists.length + 1}`)?.trim();

  if (!name) {
    return;
  }

  const list = createEmptyList(name);
  choiceLists.push(list);
  activeListId = list.id;
  if (result) {
    result.textContent = "ここに結果が表示されます。";
  }
  void persistAndRender(choiceList, emptyMessage);
});

renameListButton.addEventListener("click", () => {
  const activeList = getActiveList();
  const name = window.prompt("リスト名を編集", activeList.name)?.trim();

  if (!name) {
    return;
  }

  activeList.name = name;
  void persistAndRender(choiceList, emptyMessage);
});

deleteListButton.addEventListener("click", () => {
  const activeList = getActiveList();

  if (choiceLists.length <= 1 || !window.confirm(`${activeList.name} を削除しますか？`)) {
    return;
  }

  const nextLists = choiceLists.filter((list) => list.id !== activeList.id);
  choiceLists = nextLists.length > 0 ? nextLists : [createEmptyList()];
  activeListId = choiceLists[0].id;
  if (result) {
    result.textContent = "ここに結果が表示されます。";
  }
  void persistAndRender(choiceList, emptyMessage);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = input.value.trim();
  if (!label) {
    input.focus();
    return;
  }

  getActiveList().choices.push({ id: createChoiceId(), label });
  input.value = "";
  void persistAndRender(choiceList, emptyMessage);
  input.focus();
});

spinButton.addEventListener("click", () => {
  const choices = getActiveList().choices;

  if (isSpinning || choices.length === 0 || !rouletteWheel || !result) {
    return;
  }

  const selectedIndex = Math.floor(Math.random() * choices.length);
  const selectedChoice = choices[selectedIndex];
  const segmentAngle = 360 / choices.length;
  const segmentCenter = selectedIndex * segmentAngle + segmentAngle / 2;
  const targetRotation = 360 * 4 + (360 - segmentCenter);

  isSpinning = true;
  result.textContent = "選んでいます...";
  rouletteWheel.classList.remove("is-spinning");
  rouletteWheel.style.setProperty("--spin-target", `${targetRotation}deg`);
  void rouletteWheel.offsetWidth;
  rouletteWheel.classList.add("is-spinning");
  updateSpinState();

  window.setTimeout(() => {
    isSpinning = false;
    rouletteWheel?.classList.remove("is-spinning");
    rouletteWheel?.style.setProperty("transform", `rotate(${targetRotation}deg)`);
    if (result) {
      result.textContent = selectedChoice.label;
    }
    updateSpinState();
  }, 1400);
});

app.append(choicePanel, resultPanel);

const initialize = async (): Promise<void> => {
  const state = await loadState();
  choiceLists = state.lists.length > 0 ? state.lists : [createEmptyList()];
  activeListId = state.activeListId;
  renderListControls();
  renderChoices(choiceList, emptyMessage);
};

void initialize();
