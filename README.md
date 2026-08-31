# Test Suite Compliance

> Repository for collecting and displaying Array API test suite compliance data.

The [Array API test suite](https://github.com/data-apis/array-api-tests) is the official test suite for measuring compliance to the Python Array API standard. This repository is intended to provide a global vantage point for evaluating Array API compliance across the Scientific Python Ecosystem and to make identifying (and hopefully fixing) interoperability issues as easy as possible.

The test suite compliance dashboard is comprised of two parts:

1. **Harvester**: collects test suite reports from registered array libraries which seek to implement the standard.
2. **Dashboard**: public website for displaying test suite results.

* * *

## Registration

If you are the maintainer of an array library adopting the Array API standard and would like submit test suite results, you're in the right place!

To add your library, please do the following:

1.  Fork this repository.

2.  Edit [`registry/data.json`](https://github.com/data-apis/array-api-tests-compliance-data/blob/main/registry/data.json).

3.  Add a new entry to the `libraries` field and include the following data:

    -   **id**: unique identifier (e.g., `numpy`, `array-api-strict`, etc). This is an immutable registry identifier. Changing an identifer creates a new history, so renames should be deliberate migrations.

    -   **name**: human-readable display name (e.g., `NumPy`, `Array API Strict`, etc).

    -   **report_name**: exact expected report `name` field value. This field is intended for projects whose display or registry name differs from their installed distribution name. If not provided, defaults to `id`. _(optional)_

    -   **sources**: list one or more retrieval endpoints for harvesting test suite reports. All source objects must have the following fields:
    
        -   **id**: stable identity for the retrieval endpoint. An endpoint may publish one or more reports.
        -   **type**: the type of endpoint. Must be either: `'url'` or `'ci_artifact'`.
        
        If `type` is `url`, then a source object must have the following field:

        -   **url**: URL for the published artifact(s) (e.g., `'https://example.org/array-api-compliance/latest.json'`). Non-HTTPS URLs are not supported. Credentials should not be embedded in URLs.

        if `type` is `ci_artifact`, then a source object must have the following fields:

        -   **provider**: name of the CI provider hosting the artifact. Currently, only `'github'` is supported.

        -   **project**: provider-native human locator. For GitHub, this is `owner/repo`, not a URL.
    
        -   **ref**: structured reference for resolving an artifact. If `provider` is `github`, this should be an object with the following fields:
        
            -   **kind**: structured reference "kind". This should be equal to `'branch'`.
            -   **name**: branch name (e.g., `'main'`).
            
        -   **selector**: provider-specific artifact. If `provider` is `github`, this should be an object with the following fields:
        
            -   **workflow**: workflow filename.
            -   **artifact**: artifact name.
            
4.  Open a PR against this repository which adds the registration entry. Once merged, automated workflows will begin monitoring the registration endpoint(s).

5.  Setup your library to begin publishing test suite results. See below.

### Examples

#### GitHub

The following is an example registration entry for a GitHub workflow artifact:

```js
{
  "id": "array-api-strict",
  "name": "Array API Strict",
  "report_name": "array-api-strict",
  "sources": [
    {
      "id": "demo",
      "type": "ci_artifact",
      "provider": "github",
      "project": "data-apis/array-api-tests-compliance-data",
      "ref": {
        "kind": "branch",
        "name": "main"
      },
      "selector": {
        "workflow": "demo.yml",
        "artifact": "array_api_compliance.json"
      }
    }
  ]
}
```

#### URL

```js
{
  "id": "array-api-strict",
  "name": "Array API Strict",
  "report_name": "array-api-strict",
  "sources": [
    {
      "id": "stable-latest",
      "type": "url",
      "url": "https://example.org/array-api-compliance/latest.json"
    }
  ]
}
```


* * *

## Contact

Encountered a bug? Please file a [GitHub issue](https://github.com/data-apis/array-api-tests-compliance-data/issues?q=sort%3Aupdated-desc+is%3Aissue+state%3Aopen+). Cheers!

For other discussion, please see the [Array API](https://github.com/data-apis/array-api) repository and feel free to join one of the regular [workgroup meetings](https://github.com/data-apis/array-api#workgroup-meetings).

* * *

## License

See [LICENSE](https://github.com/data-apis/array-api-tests-compliance-data/blob/main/LICENSE).

## Copyright

Copyright &copy; 2026. Python Data APIs Consortium.
