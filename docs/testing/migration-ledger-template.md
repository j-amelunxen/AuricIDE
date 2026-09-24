# Verification Migration Ledger

Copy one row per removed test or cohesive test cluster. Do not record a test as
removed until its replacement has completed the required shadow period.

| Field                           | Value                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Area                            |                                                                                                          |
| Risk                            | low / medium / high / critical                                                                           |
| Protected rule or failure class |                                                                                                          |
| Previous test(s)                |                                                                                                          |
| Decision                        | keep / consolidate / move / remove                                                                       |
| Target bucket                   | unit-property / component-behavior / integration / contract / browser-journey / native-e2e / formal-spec |
| Replacement evidence            |                                                                                                          |
| Mutation or fault injected      |                                                                                                          |
| Fault detected by replacement   | yes / no / not applicable                                                                                |
| Shadow period                   |                                                                                                          |
| Stability result                |                                                                                                          |
| Verification gate               | fast / pr / native / release                                                                             |
| Reviewer                        |                                                                                                          |
| Rollback reference              |                                                                                                          |

## Required review questions

1. Would the replacement fail for the production defect the old test was meant
   to catch?
2. Does it exercise the real boundary responsible for that defect?
3. Are combinatorial edge cases still covered at a faster layer?
4. Can a failure be localized with the emitted diagnostics?
5. Is the replacement isolated from production user data?
