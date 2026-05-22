const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Popup root element was not found.");
}

type Choice = {
  id: string;
  label: string;
};

const STORAGE_KEY = "decideSpinnerChoices";

let choices: Choice[] = [];

const createChoiceId = (): string =>
  `choice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const isChoice = (value: unknown): value is Choice => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Choice>;
  return typeof candidate.id === "string" && typeof candidate.label === "string";
};

const loadChoices = async (): Promise<Choice[]> => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isChoice);
};

const saveChoices = async (): Promise<void> => {
  await chrome.storage.local.set({ [STORAGE_KEY]: choices });
};

const persistAndRender = async (
  listElement: HTMLUListElement,
  emptyElement: HTMLParagraphElement,
): Promise<void> => {
  await saveChoices();
  renderChoices(listElement, emptyElement);
};

const renderChoices = (listElement: HTMLUListElement, emptyElement: HTMLParagraphElement): void => {
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

  input,
  button {
    font: inherit;
  }

  input {
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid #b9c2d0;
    border-radius: 6px;
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
choicePanel.append(form, listTitle, emptyMessage, choiceList);

const resultTitle = document.createElement("p");
resultTitle.className = "section-title";
resultTitle.textContent = "結果";

const result = document.createElement("div");
result.className = "result";
result.setAttribute("aria-live", "polite");
result.textContent = "ここに結果が表示されます。";

const resultPanel = document.createElement("section");
resultPanel.className = "panel";
resultPanel.append(resultTitle, result);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = input.value.trim();
  if (!label) {
    input.focus();
    return;
  }

  choices.push({ id: createChoiceId(), label });
  input.value = "";
  void persistAndRender(choiceList, emptyMessage);
  input.focus();
});

app.append(choicePanel, resultPanel);

const initialize = async (): Promise<void> => {
  choices = await loadChoices();
  renderChoices(choiceList, emptyMessage);
};

void initialize();
