// Shared quiz widget for lesson HTML files.
// Usage: <div class="q-block" data-correct="B" data-explain="...">...<button class="q-option" data-key="A">...</button>...<div class="q-feedback"></div></div>
// Call initQuizzes() after DOM load.

function initQuizzes() {
  document.querySelectorAll(".q-block").forEach((block) => {
    const correctKey = block.dataset.correct;
    const explain = block.dataset.explain || "";
    const options = block.querySelectorAll(".q-option");
    const feedback = block.querySelector(".q-feedback");

    options.forEach((opt) => {
      opt.addEventListener("click", () => {
        if (block.dataset.answered) return;
        block.dataset.answered = "true";

        const chosenKey = opt.dataset.key;
        options.forEach((o) => (o.disabled = true));

        options.forEach((o) => {
          if (o.dataset.key === correctKey) o.classList.add("correct");
          else if (o === opt) o.classList.add("incorrect");
        });

        if (feedback) {
          const isRight = chosenKey === correctKey;
          feedback.innerHTML =
            '<div class="verdict ' +
            (isRight ? "good" : "bad") +
            '">' +
            (isRight ? "إجابة صحيحة." : "إجابة غير صحيحة.") +
            "</div>" +
            explain;
          feedback.classList.add("shown");
        }
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", initQuizzes);
