# Setup

## PyCharm IDE
- Install [PyCharm](https://www.jetbrains.com/pycharm/)
## Codex (another agent like Claude Code can be used as well)
- Ensure Codex [IDE integration](https://www.jetbrains.com/help/air/air-in-ides-manage-agents.html) is available.
- Ensure you have active subscription (???)
- Install [Superpowers](https://github.com/obra/superpowers) skill.
  - For this workshop, it will be easier to install it locally for this project using the following command prompt: `Install Superpowers skill locally for this project`. This will install the skill in the `.agents/skills` directory and other agents can use it as well.
  - In general, you can install to Codex only: `/plugins install superpowers`.
## Junie Lite (optional step)
- [Junie Lite](https://junie.jetbrains.com/docs/junie-lite.html) is available in the IDE out of the box (currently free)
- Requires a [JetBrains Account](https://account.jetbrains.com/)
- Superpowers skill can be used from `.agents/skills` -- no explicit installation required

## LM Studio
- Install [LM Studio](https://lmstudio.ai/) (It's also possible to use [oMLX](https://omlx.ai/) on macOS if you prefer)
- Download the [Mellum2.1](https://huggingface.co/mlx-community/Mellum2.1-12B-A2.5B-Thinking-6bit) model in LM Studio
## Pi coding agent
- Install [Pi](https://pi.dev/) on your machine
- Install Pi ACP [IDE integration](https://www.jetbrains.com/help/air/air-in-ides-manage-agents.html)
- Add to the `~/.pi/agent/models.json` your LMStudio provider, for example like this:
  ```
  {
    "$schema": "https://pi.dev/schemas/models.schema.json",
    "providers": {
      "lmstudio": {
        "baseUrl": "http://localhost:1234/v1",
        "api": "openai-completions",
        "apiKey": "lm-studio",
        "models": [
          { "id": "mellum2.1-12b-a2.5b-thinking" }
        ]
      }
    }
  }
  ```
- Superpowers skill can be used from `.agents/skills` -- no explicit installation required
- This repository also contains a few tricks based on [Satyrn AI Project](https://satyrn.ai/)
