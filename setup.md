# Setup

*The following instructions are primarily designed for macOS; the steps may vary slightly for Windows and Linux.*

## PyCharm IDE

- Install [PyCharm](https://www.jetbrains.com/pycharm/)

## Codex (or another agent, such as Claude Code)

- Ensure the Codex [IDE integration](https://www.jetbrains.com/help/air/air-in-ides-manage-agents.html) is available
- Install the [Superpowers](https://github.com/obra/superpowers) skill:
  - For this workshop, it is easier to install it locally for this project using the following prompt: `Install Superpowers skill locally for this project`. This installs the skill in the `.agents/skills` directory, so other agents can use it as well.

## Junie Lite

- [Junie Lite](https://junie.jetbrains.com/docs/junie-lite.html) is available in the IDE out of the box (currently free)
- Requires a [JetBrains Account](https://account.jetbrains.com/)
- The Superpowers skill can be used from `.agents/skills` — no explicit installation is required

## LM Studio

- Install [LM Studio](https://lmstudio.ai/) (on macOS, you can also use [oMLX](https://omlx.ai/) if you prefer)
- Download the Mellum2.1 model in LM Studio:
  - [MLX version for macOS](https://huggingface.co/mlx-community/Mellum2.1-12B-A2.5B-Thinking-6bit)
  - [GGUF version for Windows and Linux](https://huggingface.co/JetBrains/Mellum2.1-12B-A2.5B-Thinking)
- Set `Context Length` in the LMStudio for this model to 60K.

## Pi coding agent

- Install [Pi](https://pi.dev/) on your machine
- Install the Pi ACP [IDE integration](https://www.jetbrains.com/help/air/air-in-ides-manage-agents.html)
- You may need to open Pi in Terminal and approve **Trust** for this project folder 
- Add your LM Studio provider to `~/.pi/agent/models.json`, for example:
  ```json
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
- The Superpowers skill can be used from `.agents/skills` — no explicit installation is required
- This repository also contains a few tricks based on the [Satyrn AI Project](https://satyrn.ai/)
