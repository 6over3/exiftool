/**
 * A lightweight StringBuilder
 */
export class StringBuilder {
  private parts: string[];

  /**
   * Creates a new StringBuilder instance
   * @param initialValue Optional initial string value
   */
  constructor(initialValue = "") {
    this.parts = initialValue ? [initialValue] : [];
  }

  /**
   * Appends a string to the builder
   * @param str The string to append
   * @returns The StringBuilder instance for chaining
   */
  append(str: string): StringBuilder {
    this.parts.push(str);
    return this;
  }

  /**
 * Clears all content from the builder
 * @returns The StringBuilder instance for chaining
 */
  clear(): StringBuilder {
    this.parts = [];
    return this;
  }

  /**
   * Appends a string followed by a newline character
   * @param str The string to append
   * @returns The StringBuilder instance for chaining
   */
  appendLine(str = ""): StringBuilder {
    this.parts.push(`${str}\n`);
    return this;
  }

  /**
   * Returns the current length of the string
   */
  get length(): number {
    return this.toString().length;
  }

  /**
   * Converts the StringBuilder to a string
   * @returns The built string
   */
  toString(): string {
    return this.parts.join("");
  }

  /**
   * Checks if a string contains or ends with line breaks
   * @param str The string to check
   * @returns True if the string contains any line breaks
   */
  static isMultiline(str: string): boolean {
    // Count all line breaks in the string
    let lineBreakCount = 0;

    for (let i = 0; i < str.length; i++) {
      // Check for \n (Line Feed)
      if (str[i] === "\n") {
        lineBreakCount++;
      }
      // Check for \r (Carriage Return) not followed by \n (to avoid double counting \r\n)
      else if (
        str[i] === "\r" &&
        (i === str.length - 1 || str[i + 1] !== "\n")
      ) {
        lineBreakCount++;
      }
    }

    return lineBreakCount > 0;
  }
}
