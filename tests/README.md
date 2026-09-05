# Quiz builder regression test

Requires Node.js 22.13 or newer. From the repository root:

```sh
npm ci --prefix tests
npm test --prefix tests
```

The test loads the lecturer HTML and runs the workspace layout and builder scripts
in their production order. It exercises manual questions, generation, error
recovery, preview, drafts, reset, and duplication using simulated API responses.
It does not connect to the production service or test the AI provider itself.
