'use strict';
/**
 * Held-out corpus for the AI-assistance classifier — CODE path.
 *
 * HUMAN samples are written the way students actually submit under exam
 * pressure, and deliberately include the hard cases:
 *   - the strong student who writes clean, commented, type-hinted code
 *   - the student who uses the supplied starter template verbatim
 *   - terse one-liners, inconsistent spacing, lowercase comment fragments
 * If any of these score high the classifier is punishing good students,
 * which is far worse than missing a cheater.
 *
 * AI samples are representative of what ChatGPT / Claude / Gemini emit for
 * the beginner-to-medium stdin/stdout problems this platform actually sets.
 *
 * Every sample is labelled so `npm run bench:ai` can print a confusion table.
 */

/* ══════════════════ HUMAN — must stay LOW ══════════════════ */

const HUMAN = [
  {
    id: 'h01-py-terse-sum',
    lang: 'python',
    note: 'typical rushed submission',
    code: `a,b=map(int,input().split())
print(a+b)
`,
  },
  {
    id: 'h02-py-bigger',
    lang: 'python',
    note: 'if/elif ladder, no comments',
    code: `a, b = map(int, input().split())
if a > b:
    print(a)
elif b > a:
    print(b)
else:
    print("Equal")
`,
  },
  {
    id: 'h03-py-twosum-brute',
    lang: 'python',
    note: 'brute force, single-letter locals',
    code: `import sys
d = sys.stdin.read().split()
n = int(d[0])
t = int(d[1])
a = [int(x) for x in d[2:2+n]]
for i in range(n):
    for j in range(i+1,n):
        if a[i]+a[j]==t:
            print(i,j)
            exit()
`,
  },
  {
    id: 'h04-py-messy-spacing',
    lang: 'python',
    note: 'mixed operator spacing, a lowercase note',
    code: `import sys
data=sys.stdin.read().split()
n=int(data[0])
nums=list(map(int,data[1:]))
# seen so far
seen={}
for i in range(n):
    x = nums[i]
    if x in seen:
        print(seen[x], i)
        break
    seen[x]=i
`,
  },
  {
    id: 'h05-cpp-sum',
    lang: 'cpp',
    note: 'competitive-programming style',
    code: `#include <bits/stdc++.h>
using namespace std;
int main(){
    int a,b;
    cin>>a>>b;
    cout<<a+b<<endl;
    return 0;
}
`,
  },
  {
    id: 'h06-cpp-sort',
    lang: 'cpp',
    note: 'vector + sort, terse',
    code: `#include <bits/stdc++.h>
using namespace std;
int main(){
    int n; cin>>n;
    vector<int> v(n);
    for(int i=0;i<n;i++) cin>>v[i];
    sort(v.begin(),v.end());
    for(int i=0;i<n;i++) cout<<v[i]<<" ";
    cout<<"\\n";
}
`,
  },
  {
    id: 'h07-java-sum',
    lang: 'java',
    note: 'Scanner boilerplate',
    code: `import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        System.out.println(a + b);
    }
}
`,
  },
  {
    id: 'h08-js-sum',
    lang: 'javascript',
    note: 'node stdin',
    code: `const data = require('fs').readFileSync(0, 'utf8').split(/\\s+/);
let a = parseInt(data[0]);
let b = parseInt(data[1]);
console.log(a + b);
`,
  },
  {
    id: 'h09-py-strong-student',
    lang: 'python',
    note: 'HARD CASE: good student, clean + typed + commented',
    code: `import sys
from typing import List

def two_sum(nums: List[int], target: int) -> List[int]:
    seen = {}
    for i, x in enumerate(nums):
        if target - x in seen:
            return [seen[target - x], i]
        seen[x] = i
    return []

data = sys.stdin.read().split()
n, target = int(data[0]), int(data[1])
nums = [int(v) for v in data[2:2 + n]]
print(*two_sum(nums, target))
`,
  },
  {
    id: 'h10-py-starter-template',
    lang: 'python',
    note: 'HARD CASE: the starter template the platform itself supplies',
    code: `import sys

def solve():
    data = sys.stdin.read().split()
    a, b = int(data[0]), int(data[1])
    print(a + b)

if __name__ == '__main__':
    solve()
`,
  },
  {
    id: 'h11-py-own-comments',
    lang: 'python',
    note: 'HARD CASE: student who does comment, but in fragments',
    code: `import sys
lines = sys.stdin.read().split()
# first two are n and target
n = int(lines[0])
t = int(lines[1])
arr = list(map(int, lines[2:]))
# use dict
d = {}
for i in range(n):
    need = t - arr[i]
    if need in d:
        print(d[need], i)
        break
    d[arr[i]] = i
`,
  },
  {
    id: 'h12-py-reverse-string',
    lang: 'python',
    note: 'one-liner',
    code: `s = input().strip()
print(s[::-1])
print(len(s))
print(s.upper())
print(s.lower())
`,
  },
  {
    id: 'h13-cpp-fib-memo',
    lang: 'cpp',
    note: 'student DP, short names',
    code: `#include <bits/stdc++.h>
using namespace std;
long long dp[100005];
long long f(int n){
    if(n<=1) return n;
    if(dp[n]!=-1) return dp[n];
    return dp[n]=f(n-1)+f(n-2);
}
int main(){
    memset(dp,-1,sizeof(dp));
    int n; cin>>n;
    cout<<f(n);
}
`,
  },
  {
    id: 'h14-py-debug-leftovers',
    lang: 'python',
    note: 'commented-out debug lines — very human',
    code: `import sys
data = sys.stdin.read().split()
n = int(data[0])
arr = list(map(int, data[1:n+1]))
# print(arr)
total = 0
for x in arr:
    total += x
# print("total", total)
print(total / n)
`,
  },
  {
    id: 'h15-java-verbose-student',
    lang: 'java',
    note: 'HARD CASE: Java forces long names even on humans',
    code: `import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int numberCount = scanner.nextInt();
        int totalSum = 0;
        for (int index = 0; index < numberCount; index++) {
            totalSum = totalSum + scanner.nextInt();
        }
        System.out.println(totalSum);
    }
}
`,
  },
  {
    id: 'h16-py-while-loop',
    lang: 'python',
    note: 'reads until EOF',
    code: `import sys
total=0
cnt=0
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    total+=int(line)
    cnt+=1
print(total,cnt)
`,
  },
  {
    id: 'h17-py-palindrome',
    lang: 'python',
    note: 'manual two-pointer',
    code: `s=input().strip().lower()
i=0
j=len(s)-1
ok=True
while i<j:
    if s[i]!=s[j]:
        ok=False
        break
    i+=1
    j-=1
if ok:
    print("YES")
else:
    print("NO")
`,
  },
  {
    id: 'h18-cpp-struct',
    lang: 'cpp',
    note: 'HARD CASE: student using a struct + descriptive names',
    code: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
struct Student {
    string name;
    int marks;
};
int main(){
    int n; cin>>n;
    vector<Student> list(n);
    for(int i=0;i<n;i++) cin>>list[i].name>>list[i].marks;
    sort(list.begin(),list.end(),[](Student x,Student y){return x.marks>y.marks;});
    for(auto s:list) cout<<s.name<<" "<<s.marks<<"\\n";
}
`,
  },
  {
    id: 'h19-py-hindi-comments',
    lang: 'python',
    note: 'HARD CASE: Hinglish/Devanagari notes are a HUMAN tell, never AI',
    code: `import sys
# yahan input padhte hain
data = sys.stdin.read().split()
# दोनों number ko int banao
a = int(data[0])
b = int(data[1])
# jod kar print karo
print(a+b)
`,
  },
  {
    id: 'h20-py-emdash-in-output',
    lang: 'python',
    note: 'HARD CASE: the PROBLEM asked for an em-dash in the output string',
    code: `import sys
d = sys.stdin.read().split()
n = int(d[0])
arr = list(map(int, d[1:]))
for x in arr:
    print("value \u2014 " + str(x))
print(sum(arr))
`,
  },
  {
    id: 'h21-py-curly-quote-string',
    lang: 'python',
    note: 'HARD CASE: curly apostrophe inside a required output literal',
    code: `s = input()
if s == "dont":
    print("it is")
else:
    print("it isn\u2019t")
print(len(s))
`,
  },
];

/* ══════════════════ AI — must score HIGH ══════════════════ */

const AI = [
  {
    id: 'a01-py-chatgpt-twosum',
    lang: 'python',
    note: 'classic ChatGPT answer with docstring + narration',
    code: `import sys
from typing import List


def two_sum(nums: List[int], target: int) -> List[int]:
    """
    Find the indices of the two numbers that add up to the target.

    Args:
        nums: List of integers to search.
        target: The target sum we are looking for.

    Returns:
        A list containing the two indices, or an empty list if none exist.
    """
    # Dictionary to store previously seen values and their indices
    seen = {}

    # Iterate through the list with both index and value
    for index, value in enumerate(nums):
        complement = target - value

        # Check if the complement has already been seen
        if complement in seen:
            return [seen[complement], index]

        # Store the current value and its index for future lookups
        seen[value] = index

    # Return an empty list if no valid pair is found
    return []


def main():
    # Read all input from standard input
    data = sys.stdin.read().split()

    # Parse the first two values as n and target
    n = int(data[0])
    target = int(data[1])

    # Parse the remaining values as the number list
    nums = [int(x) for x in data[2:2 + n]]

    # Compute and display the result
    result = two_sum(nums, target)
    print(result[0], result[1])


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a02-py-bigger-overengineered',
    lang: 'python',
    note: 'trivial problem, full error handling',
    code: `import sys


def find_larger(first: int, second: int) -> str:
    """
    Compare two integers and return the larger one.

    Args:
        first: The first integer.
        second: The second integer.

    Returns:
        The larger value as a string, or "Equal" if they are the same.
    """
    # Check if the first number is greater than the second
    if first > second:
        return str(first)
    # Check if the second number is greater than the first
    elif second > first:
        return str(second)
    # Both numbers are equal
    else:
        return "Equal"


def main():
    # Read the input line and split it into tokens
    try:
        line = sys.stdin.readline().strip()
        first_number, second_number = map(int, line.split())
    except ValueError:
        raise ValueError("Input must contain exactly two integers")

    # Print the result of the comparison
    print(find_larger(first_number, second_number))


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a03-py-fence-left-in',
    lang: 'python',
    note: 'markdown fence pasted out of the chat window',
    code: `\`\`\`python
import sys

def main():
    # Read the two integers from input
    a, b = map(int, sys.stdin.read().split())

    # Print their sum
    print(a + b)

if __name__ == "__main__":
    main()
\`\`\`

This solution reads two integers from standard input and prints their sum.
The time complexity is O(1) and the space complexity is O(1).
`,
  },
  {
    id: 'a04-cpp-gpt-style',
    lang: 'cpp',
    note: 'AI C++ with section banners',
    code: `#include <iostream>
#include <vector>
#include <unordered_map>

using namespace std;

/**
 * Finds two indices whose values sum to the target.
 *
 * @param nums The vector of input numbers.
 * @param target The target sum.
 * @return A pair of indices, or (-1, -1) if no solution exists.
 */
pair<int, int> findTwoSum(const vector<int>& nums, int target) {
    // Hash map to store the value and its corresponding index
    unordered_map<int, int> seenValues;

    // Traverse through the array once
    for (int currentIndex = 0; currentIndex < nums.size(); currentIndex++) {
        int complement = target - nums[currentIndex];

        // Check whether the complement already exists in the map
        if (seenValues.find(complement) != seenValues.end()) {
            return {seenValues[complement], currentIndex};
        }

        // Store the current number along with its index
        seenValues[nums[currentIndex]] = currentIndex;
    }

    // Return a sentinel value when no pair is found
    return {-1, -1};
}

int main() {
    // Read the number of elements and the target value
    int elementCount, targetSum;
    cin >> elementCount >> targetSum;

    // Read all the elements into the vector
    vector<int> numbers(elementCount);
    for (int i = 0; i < elementCount; i++) {
        cin >> numbers[i];
    }

    // Compute the result and display it
    pair<int, int> result = findTwoSum(numbers, targetSum);
    cout << result.first << " " << result.second << endl;

    return 0;
}
`,
  },
  {
    id: 'a05-java-gpt-style',
    lang: 'java',
    note: 'Javadoc + narration',
    code: `import java.util.HashMap;
import java.util.Map;
import java.util.Scanner;

/**
 * Solution class that solves the Two Sum problem efficiently.
 */
public class Main {

    /**
     * Finds the indices of two numbers that add up to the target.
     *
     * @param numbers the array of input numbers
     * @param target the target sum
     * @return an array containing the two indices
     */
    public static int[] findTwoSum(int[] numbers, int target) {
        // Map to store each value and the index where it was seen
        Map<Integer, Integer> seenValues = new HashMap<>();

        // Iterate through the array a single time
        for (int currentIndex = 0; currentIndex < numbers.length; currentIndex++) {
            int complement = target - numbers[currentIndex];

            // Check if the complement was already encountered
            if (seenValues.containsKey(complement)) {
                return new int[]{seenValues.get(complement), currentIndex};
            }

            // Record the current value for future lookups
            seenValues.put(numbers[currentIndex], currentIndex);
        }

        // Return an empty array when no solution exists
        return new int[]{};
    }

    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);

        // Read the element count and the target sum
        int elementCount = scanner.nextInt();
        int targetSum = scanner.nextInt();

        // Populate the array with the provided values
        int[] numbers = new int[elementCount];
        for (int i = 0; i < elementCount; i++) {
            numbers[i] = scanner.nextInt();
        }

        // Display the resulting indices
        int[] result = findTwoSum(numbers, targetSum);
        System.out.println(result[0] + " " + result[1]);
    }
}
`,
  },
  {
    id: 'a06-py-complexity-notes',
    lang: 'python',
    note: 'complexity annotations in comments',
    code: `import sys

# Time Complexity: O(n log n)
# Space Complexity: O(n)


def sort_and_print(numbers):
    """Sort the given numbers in ascending order and print them."""
    # Use the built-in sort for optimal performance
    sorted_numbers = sorted(numbers)

    # Join the numbers into a single space separated string
    output = " ".join(str(number) for number in sorted_numbers)

    # Display the final result
    print(output)


def main():
    # Read the entire input at once for efficiency
    data = sys.stdin.read().split()

    # The first token represents the count of numbers
    count = int(data[0])

    # Convert the remaining tokens into integers
    numbers = [int(token) for token in data[1:count + 1]]

    # Delegate the work to the helper function
    sort_and_print(numbers)


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a07-py-emdash-comments',
    lang: 'python',
    note: 'HARD TELL: em-dash and curly quotes no keyboard produces',
    code: `import sys


def main():
    # Read the input values — we expect two integers on one line
    data = sys.stdin.read().split()

    # Guard against malformed input (it's safer this way)
    if len(data) < 2:
        print("Invalid input")
        return

    first, second = int(data[0]), int(data[1])

    # Print the sum of the two values
    print(first + second)


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a08-py-explanation-mixed',
    lang: 'python',
    note: 'whole chat answer pasted — prose + code together',
    code: `Here's the solution to your problem:

import sys

def main():
    # Read two integers from standard input
    a, b = map(int, sys.stdin.read().split())

    # Calculate and print the sum
    print(a + b)

if __name__ == "__main__":
    main()

Explanation:
1. We read the entire input using sys.stdin.read() for efficiency.
2. The split() method breaks the input into individual tokens.
3. We use map(int, ...) to convert the tokens into integers.
4. Finally, we print the sum of the two numbers.

Let me know if you need any clarification!
`,
  },
  {
    id: 'a09-py-multi-approach',
    lang: 'python',
    note: 'offers two approaches, as chat answers do',
    code: `import sys

# Approach 1: Brute force solution with O(n^2) time complexity
# Approach 2: Optimized hash map solution with O(n) time complexity
# We will use the optimized approach below.


def two_sum_optimized(numbers, target_value):
    """Return the indices of two numbers adding up to target_value."""
    # Dictionary that maps a value to the index where it appeared
    value_to_index = {}

    # Traverse the list a single time
    for current_index, current_value in enumerate(numbers):
        # Calculate the value we still need
        required_value = target_value - current_value

        # If we have already seen it, we found our answer
        if required_value in value_to_index:
            return value_to_index[required_value], current_index

        # Otherwise remember the current value
        value_to_index[current_value] = current_index

    # No valid combination was found
    return None


def main():
    data = sys.stdin.read().split()
    count = int(data[0])
    target_value = int(data[1])
    numbers = [int(token) for token in data[2:2 + count]]

    result = two_sum_optimized(numbers, target_value)
    if result:
        print(result[0], result[1])


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a10-js-gpt-style',
    lang: 'javascript',
    note: 'JSDoc + narration',
    code: `const fs = require('fs');

/**
 * Reads all input from standard input and returns the parsed tokens.
 *
 * @returns {string[]} An array of whitespace separated tokens.
 */
function readInput() {
    // Read the entire standard input as a UTF-8 string
    const rawInput = fs.readFileSync(0, 'utf8');

    // Split the input on any whitespace and remove empty entries
    return rawInput.trim().split(/\\s+/);
}

/**
 * Calculates the sum of two numbers.
 *
 * @param {number} firstNumber The first operand.
 * @param {number} secondNumber The second operand.
 * @returns {number} The sum of both operands.
 */
function calculateSum(firstNumber, secondNumber) {
    // Return the arithmetic sum of the two provided values
    return firstNumber + secondNumber;
}

function main() {
    // Obtain the tokens from standard input
    const tokens = readInput();

    // Convert the first two tokens into numbers
    const firstNumber = parseInt(tokens[0], 10);
    const secondNumber = parseInt(tokens[1], 10);

    // Display the computed sum
    console.log(calculateSum(firstNumber, secondNumber));
}

main();
`,
  },
  {
    id: 'a11-py-light-ai',
    lang: 'python',
    note: 'HARD CASE: short AI answer, few comments — the current miss',
    code: `import sys


def main():
    # Read the input values
    data = sys.stdin.read().split()

    # Convert the tokens to integers
    first_number = int(data[0])
    second_number = int(data[1])

    # Print the result
    print(first_number + second_number)


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a12-py-palindrome-ai',
    lang: 'python',
    note: 'AI palindrome with helper + docstring',
    code: `def is_palindrome(text: str) -> bool:
    """
    Determine whether the provided text is a palindrome.

    Args:
        text: The string to evaluate.

    Returns:
        True if the text reads the same forwards and backwards.
    """
    # Normalize the text by removing spaces and converting to lowercase
    normalized_text = text.replace(" ", "").lower()

    # Compare the normalized text with its reverse
    return normalized_text == normalized_text[::-1]


def main():
    # Read a single line of input from the user
    user_input = input().strip()

    # Display YES or NO based on the palindrome check
    if is_palindrome(user_input):
        print("YES")
    else:
        print("NO")


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a13-cpp-light-ai',
    lang: 'cpp',
    note: 'HARD CASE: short AI C++, modest commenting',
    code: `#include <iostream>
using namespace std;

int main() {
    // Declare variables to store the two input numbers
    int firstNumber, secondNumber;

    // Read the two numbers from standard input
    cin >> firstNumber >> secondNumber;

    // Calculate the sum of both numbers
    int sum = firstNumber + secondNumber;

    // Output the final result
    cout << sum << endl;

    return 0;
}
`,
  },
  {
    id: 'a14-py-unused-imports',
    lang: 'python',
    note: 'kitchen-sink imports for a trivial task',
    code: `import sys
import os
import json
from typing import List, Dict, Optional, Tuple
from collections import defaultdict


def process_input(raw_data: str) -> List[int]:
    """Convert the raw input string into a list of integers."""
    # Split the raw data on whitespace boundaries
    tokens = raw_data.split()

    # Convert every token into an integer value
    return [int(token) for token in tokens]


def main() -> None:
    """Entry point of the program."""
    # Read the complete standard input stream
    raw_data = sys.stdin.read()

    # Parse the data into a usable list of numbers
    numbers = process_input(raw_data)

    # Compute the total of all the numbers
    total = sum(numbers)

    # Display the computed total to the user
    print(total)


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a15-py-certainly',
    lang: 'python',
    note: 'assistant preamble survived the copy',
    code: `# Certainly! Here's a Python solution for the problem:

import sys


def calculate_average(numbers):
    """Calculate the arithmetic mean of a list of numbers."""
    # Guard against division by zero
    if not numbers:
        return 0

    # Return the sum divided by the count
    return sum(numbers) / len(numbers)


def main():
    # Read all the whitespace separated tokens
    data = sys.stdin.read().split()

    # The first token tells us how many numbers follow
    count = int(data[0])

    # Build the list of numbers from the remaining tokens
    numbers = [int(value) for value in data[1:count + 1]]

    # Print the average with full precision
    print(calculate_average(numbers))


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a16-java-light-ai',
    lang: 'java',
    note: 'HARD CASE: Java AI without Javadoc — naming alone must not convict',
    code: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);

        // Read the first integer from the input
        int firstNumber = scanner.nextInt();

        // Read the second integer from the input
        int secondNumber = scanner.nextInt();

        // Calculate the sum of the two numbers
        int result = firstNumber + secondNumber;

        // Print the final result to the console
        System.out.println(result);

        scanner.close();
    }
}
`,
  },
  {
    id: 'a17-py-step-banners',
    lang: 'python',
    note: 'Step 1 / Step 2 banner comments',
    code: `import sys


def main():
    # Step 1: Read the input from standard input
    data = sys.stdin.read().split()

    # Step 2: Parse the number of elements
    count = int(data[0])

    # Step 3: Extract the list of numbers
    numbers = [int(value) for value in data[1:count + 1]]

    # Step 4: Find the maximum value in the list
    maximum_value = max(numbers)

    # Step 5: Find the minimum value in the list
    minimum_value = min(numbers)

    # Step 6: Print both results on separate lines
    print(maximum_value)
    print(minimum_value)


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'a18-py-note-block',
    lang: 'python',
    note: 'trailing explanation block after the code',
    code: `import sys

def count_vowels(text):
    """Count how many vowels appear in the given text."""
    # Define the set of vowel characters for fast lookup
    vowels = set("aeiouAEIOU")

    # Use a generator expression to count matching characters
    return sum(1 for character in text if character in vowels)

def main():
    # Read the line of text from standard input
    text = sys.stdin.readline().strip()

    # Print the number of vowels found
    print(count_vowels(text))

if __name__ == "__main__":
    main()

# Note: This solution runs in O(n) time where n is the length of the string.
# It handles both uppercase and lowercase vowels correctly.
`,
  },
];

module.exports = { HUMAN, AI };
