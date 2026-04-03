// math.js
function greatestCommonDivisor(num1, num2) {
    let number1 = num1;
    let number2 = num2;

    while (number1 !== number2) {
        if (number1 > number2) {
            number1 = number1 - number2;
        } else {
            number2 = number2 - number1;
        }
    }

    return number2;
}

function leastCommonMultiple(num1, num2) {
    const number1 = num1;
    const number2 = num2;
    const gcd = greatestCommonDivisor(number1, number2);
    return (number1 * number2) / gcd;
}

export default leastCommonMultiple;